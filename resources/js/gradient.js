import * as THREE from 'three';
import Editor from './Editor';
var MeshLine = require('three.meshline');


const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, 1, 0, 1, 1, 1000);
const camera2 = new THREE.PerspectiveCamera(50, 1, 1, 1000);
camera2.position.z = 3;
camera2.position.x = 0.5;
camera2.position.y = 0.5;
camera2.lookAt(0.5, 0.5, 0);
scene.add(camera2);


const meshGradientMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: THREE.VertexColors, side: THREE.DoubleSide });
const wireframeMeshMaterial = new THREE.MeshPhongMaterial({
  color: 0xffffff,
  polygonOffset: true,
  polygonOffsetFactor: 1, // positive value pushes polygon further away
  polygonOffsetUnits: 1
});

let sceneCamera = camera;
const imageQuality = 5000;

const renderer = new THREE.WebGLRenderer({ alpha: true });
const parentElement = document.querySelector('.gradient-mesh');
const colorPickerContainer = document.querySelector('.aColorPicker');
// renderer.setSize(parentElement.clientWidth, parentElement.clientHeight);
renderer.setSize(imageQuality, imageQuality);
renderer.domElement.style = '';
parentElement.insertBefore(renderer.domElement, parentElement.firstChild);

const ambientLight = new THREE.AmbientLight(0xffffff);
scene.add(ambientLight);

camera.position.z = 10;
const patchDivCount = 20;

let initialDivisionCount = 3;
var editor;
//var editor = new Editor(initialDivisionCount, parentElement);

function transpose(matrix) {
  const w = matrix.length || 0;
  const h = matrix[0] instanceof Array ? matrix[0].length : 0;
  if (h === 0 || w === 0) { return []; }
  const t = [];

  for (let i = 0; i < h; i++) {
    t[i] = [];
    for (let j = 0; j < w; j++) {
      t[i][j] = matrix[j][i];
    }
  }
  return t;
}

function multiply(a, b) {
  const aNumRows = a.length;
  const aNumCols = a[0].length;
  const bNumRows = b.length;
  const bNumCols = b[0].length,
    m = new Array(aNumRows);  // initialize array of rows
  for (let r = 0; r < aNumRows; ++r) {
    m[r] = new Array(bNumCols); // initialize the current row
    for (let c = 0; c < bNumCols; ++c) {
      m[r][c] = 0;             // initialize the current cell
      for (let i = 0; i < aNumCols; ++i) {
        m[r][c] += a[r][i] * b[i][c];
      }
    }
  }
  return m;
}

const HM = [
  [2, -2, 1, 1],
  [-3, 3, -2, -1],
  [0, 0, 1, 0],
  [1, 0, 0, 0],
];

const HM_T = transpose(HM);

function getPatchAttribute(matrix, i, j, attributeName, tangentName) {
  if (tangentName) {
    return ([
      [matrix[i][j][attributeName], matrix[i + 1][j][attributeName], matrix[i][j][tangentName].negDir.x, matrix[i + 1][j][tangentName].posDir.x],
      [matrix[i][j + 1][attributeName], matrix[i + 1][j + 1][attributeName], matrix[i][j + 1][tangentName].negDir.x, matrix[i + 1][j + 1][tangentName].posDir.x],
      [matrix[i][j][tangentName].negDir.y, matrix[i + 1][j][tangentName].negDir.y, 0, 0],
      [matrix[i][j + 1][tangentName].posDir.y, matrix[i + 1][j + 1][tangentName].posDir.y, 0, 0],
    ]);
  }
  return ([
    [matrix[i][j][attributeName], matrix[i + 1][j][attributeName], 0, 0],
    [matrix[i][j + 1][attributeName], matrix[i + 1][j + 1][attributeName], 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ])
}

function getPatch(controlPoints, i, j) {
  const patch = {};
  patch.x = getPatchAttribute(controlPoints, i, j, 'x', 'uTangents');
  patch.y = getPatchAttribute(controlPoints, i, j, 'y', 'vTangents');
  patch.r = getPatchAttribute(controlPoints, i, j, 'r');
  patch.g = getPatchAttribute(controlPoints, i, j, 'g');
  patch.b = getPatchAttribute(controlPoints, i, j, 'b');
  return patch;
}

function getPatches(controlPoints) {
  const patches = [];
  const columnLength = controlPoints.length - 1;
  for (let i = 0; i < columnLength; i++) {
    const rowLength = controlPoints[i].length - 1;
    for (let j = 0; j < rowLength; j++) {
      const patch = getPatch(controlPoints, i, j);
      patches.push(patch);
    }
  }
  return patches;
}

// function getMatrix(refMatrix) {
//   const matrix = [];
//   for (let i = 0; i < refMatrix.length; i++) {
//     matrix[i] = [];
//     for (let j = 0; j < refMatrix[i].length; j++) {
//       matrix[i].push(refMatrix[i][j]);
//     }
//   }
//   return matrix;
// }

function getPatchPoint(hermitePatch, u, v) {
  const Uvec = [[u ** 3], [u ** 2], [u], [1]];
  const Vvec = [[v ** 3], [v ** 2], [v], [1]];
  const vec = multiply(multiply(multiply(multiply(transpose(Uvec), HM), hermitePatch), HM_T), Vvec);
  return vec[0][0];
}

let allPatches = null;//getPatches(editor.controlPointMatrix);
let hermitePatches = new THREE.Group();
let positionBufferAttribute = new THREE.BufferAttribute(new Float32Array([]), 3);
let colorBufferAttribute = new THREE.BufferAttribute(new Float32Array([]), 3);
const gradientMeshGeometry = new THREE.BufferGeometry();

const patchVertexCount = (patchDivCount + 1) * (patchDivCount + 1);
const patchFaceCount = patchDivCount * patchDivCount * 2;
var vertexCount = 4 * patchFaceCount * 3;//allPatches.length * patchFaceCount * 3;

let gradientMesh;
var vertexArray = new Array(vertexCount * 3);
var colorArray = new Array(vertexCount * 3);
const surfaceElements = new Array(patchVertexCount * 3);
const vertexColors = new Array(patchVertexCount * 3);
let vertices;
let colors;

function fillBufferAttributeByPatches(patches, positionAttr, colorAttr) {
  patches.forEach((patch, patchIndex) => {
    for (let i = 0; i <= patchDivCount; i++) {
      for (let j = 0; j <= patchDivCount; j++) {
        const x = getPatchPoint(patch.x, i / patchDivCount, j / patchDivCount);
        const y = getPatchPoint(patch.y, i / patchDivCount, j / patchDivCount);
        const r = getPatchPoint(patch.r, i / patchDivCount, j / patchDivCount);
        const g = getPatchPoint(patch.g, i / patchDivCount, j / patchDivCount);
        const b = getPatchPoint(patch.b, i / patchDivCount, j / patchDivCount);
        const z = (r + g + b) / 6;
        const baseIndex = ((i * (patchDivCount + 1)) + j) * 3;
        surfaceElements[baseIndex] = x;
        surfaceElements[baseIndex + 1] = y;
        surfaceElements[baseIndex + 2] = z;
        vertexColors[baseIndex] = r;
        vertexColors[baseIndex + 1] = g;
        vertexColors[baseIndex + 2] = b;
      }
    }
    for (let i = 0; i < patchDivCount; i++) {
      for (let j = 0; j < patchDivCount; j++) {
        const baseIndex = ((patchIndex * (patchFaceCount / 2)) + (i * patchDivCount) + j) * 6;
        /*
        v1----v3
        |   / |
        | /   |
        v2---v4
        */
        const v1_index = (i * (patchDivCount + 1) + j) * 3;
        setBufferAttributeFromArray(positionAttr, baseIndex, surfaceElements, v1_index);
        setBufferAttributeFromArray(colorAttr, baseIndex, vertexColors, v1_index);

        const v2_index = ((i + 1) * (patchDivCount + 1) + j) * 3;
        setBufferAttributeFromArray(positionAttr, baseIndex + 1, surfaceElements, v2_index);
        setBufferAttributeFromArray(colorAttr, baseIndex + 1, vertexColors, v2_index);

        setBufferAttributeFromArray(positionAttr, baseIndex + 3, surfaceElements, v2_index);
        setBufferAttributeFromArray(colorAttr, baseIndex + 3, vertexColors, v2_index);

        const v3_index = (i * (patchDivCount + 1) + (j + 1)) * 3;
        setBufferAttributeFromArray(positionAttr, baseIndex + 2, surfaceElements, v3_index);
        setBufferAttributeFromArray(colorAttr, baseIndex + 2, vertexColors, v3_index);

        setBufferAttributeFromArray(positionAttr, baseIndex + 4, surfaceElements, v3_index);
        setBufferAttributeFromArray(colorAttr, baseIndex + 4, vertexColors, v3_index);

        const v4_index = ((i + 1) * (patchDivCount + 1) + (j + 1)) * 3;
        setBufferAttributeFromArray(positionAttr, baseIndex + 5, surfaceElements, v4_index);
        setBufferAttributeFromArray(colorAttr, baseIndex + 5, vertexColors, v4_index);
      }
    }
  });
}

function initializeHermiteSurface() {

  fillBufferAttributeByPatches(allPatches, positionBufferAttribute, colorBufferAttribute);
  vertices = new Float32Array(vertexArray);
  colors = new Float32Array(colorArray);
  positionBufferAttribute.setArray(vertices);
  positionBufferAttribute.setDynamic(true);
  gradientMeshGeometry.addAttribute('position', positionBufferAttribute);

  colorBufferAttribute.setArray(colors);
  colorBufferAttribute.setDynamic(true);
  gradientMeshGeometry.addAttribute('color', colorBufferAttribute);
  gradientMesh = new THREE.Mesh(gradientMeshGeometry, meshGradientMaterial);
  scene.add(gradientMesh);

  gradientMesh.geometry.attributes.position.needsUpdate = true;
  gradientMesh.geometry.attributes.color.needsUpdate = true;
}

function setBufferAttributeFromArray(attr, attrIndex, array, vertexIndex) {
  attr.setXYZ(attrIndex, array[vertexIndex], array[vertexIndex + 1], array[vertexIndex + 2]);
}

function calculateHermiteSurface(t) {
  allPatches = getPatches(editor.controlPointMatrix);
  fillBufferAttributeByPatches(allPatches, gradientMesh.geometry.attributes.position, gradientMesh.geometry.attributes.color);
  gradientMesh.geometry.attributes.position.needsUpdate = true;
  gradientMesh.geometry.attributes.color.needsUpdate = true;
}

window.addEventListener('keydown', (e) => {
  switch (e.code) {
    case "Space":
      gradientMesh.material = (gradientMesh.material == meshGradientMaterial) ? wireframeMeshMaterial : meshGradientMaterial;
      calculateHermiteSurface();
      renderer.render(scene, sceneCamera);
      break;
    case "ShiftLeft":
      editor.toggleTangentBinding();
      calculateHermiteSurface();
      renderer.render(scene, sceneCamera);
      break;
    case "KeyR":
      editor.resetSelectedCpTangent();
      calculateHermiteSurface();
      renderer.render(scene, sceneCamera);
      break;
    case "KeyS":
      drawLines()
      //drawTestLine(true);
      break;
  }
});


// window.addEventListener('keydown', (e) => {
//   if (e.code === 'Space') {
//     calculateHermiteSurface();
//     renderer.render(scene, sceneCamera);
//   }
//   if (e.code === 'Digit1') {
//     calculateHermiteSurface();
//     sceneCamera = camera;
//     renderer.render(scene, sceneCamera);
//   }
//   if (e.code === 'Digit2') {
//     calculateHermiteSurface();
//     sceneCamera = camera2;
//     renderer.render(scene, sceneCamera);
//   }
//   if (e.code === 'KeyR') {
//     editor.resetSelectedCpTangent();
//     calculateHermiteSurface();
//     renderer.render(scene, sceneCamera);
//   }
//   if (e.code === 'KeyX') {
//     editor.toggleCpXHandles();
//     calculateHermiteSurface();
//     renderer.render(scene, sceneCamera);
//   }
//   if (e.code === 'KeyY') {
//     editor.toggleCpYHandles();
//     calculateHermiteSurface();
//     renderer.render(scene, sceneCamera);
//   }
//   if (e.code === 'KeyX' && e.altKey) {
//     editor.resetCpXHandles();
//     calculateHermiteSurface();
//     renderer.render(scene, sceneCamera);
//   }
//   if (e.code === 'KeyY' && e.altKey) {
//     editor.resetCpYHandles();
//     calculateHermiteSurface();
//     renderer.render(scene, sceneCamera);
//   }
//   if (e.code === 'ShiftLeft') {
//     editor.toggleTangentBinding();
//     calculateHermiteSurface();
//     renderer.render(scene, sceneCamera);
//   }
// });


const animate = (t) => {

  if (editor.currentlyMovingCp || editor.currentlyMovingTangent) {
    updateCPlines();
  }

  if (editor.shouldRefresh) {
    calculateHermiteSurface(t);
    renderer.render(scene, sceneCamera);
  }
  requestAnimationFrame(() => animate(t + 0.05));
};

//animate(0);

// UI Interaction

document.addEventListener('contextmenu', (e) => {
  //e.preventDefault()
});

document.getElementById('btnAccept').addEventListener("click", () => {
  editor.toggleTangentBinding();
  gradientMesh.material = meshGradientMaterial;
  calculateHermiteSurface();
  renderer.render(scene, sceneCamera);

  var meshGradientBase64 = document.querySelector('canvas').toDataURL('image/png', 1.0).replace("data:image/png;base64,", "");

  var pointMatrix = JSON.stringify(editor.getStorePointArray());
  window.postMessage("ConfirmMeshGradient", meshGradientBase64, pointMatrix);
});

window.cancelAssignation = () => {
  window.postMessage('Cancel');
}

document.getElementById('btnCancel').addEventListener("click", () => {
  window.postMessage("nativeLog", "WV - Cancel");
  cancelAssignation();
});


window.LoadMesh = (meshGradientDefinition) => {

  if (meshGradientDefinition != null) {
    var parsed = JSON.parse(meshGradientDefinition);
    initialDivisionCount = Math.sqrt(parsed.length) - 1
  }
  editor = new Editor(initialDivisionCount, parentElement, colorPickerContainer, meshGradientDefinition);
  allPatches = getPatches(editor.controlPointMatrix);
  vertexCount = allPatches.length * patchFaceCount * 3;
  vertexArray = new Array(vertexCount * 3);
  colorArray = new Array(vertexCount * 3);
  initializeHermiteSurface();
  animate(0);
}

let horizontalLines = new Map();
let verticalLines = new Map();
const coolmaterial = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 4 });
let line;


const drawTestLine = (log) => {
  if (!line) {
    let curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.2, 0),
      new THREE.Vector3(1, 0.8, 0),
      new THREE.Vector3(1, 1, 0)
    );

    window.postMessage("nativeLog", "creating line")
    let geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
    line = new THREE.Line(geometry, coolmaterial);
    line.curve = curve;
    scene.add(line);


  }
  {
    if (log) {
      window.postMessage("nativeLog", line.curve.v3)
      window.postMessage("nativeLog", "updating line to " + (editor.mouseX / editor.boundingRect.width) + "," + (editor.mouseY / editor.boundingRect.height))
    }

    line.curve.v3.x = (editor.mouseX - editor.boundingRect.x) / editor.boundingRect.width;
    line.curve.v3.y = (editor.mouseY - editor.boundingRect.y) / editor.boundingRect.height;
    line.geometry.setFromPoints(line.curve.getPoints(50));
    line.geometry.attributes.position.needsUpdate = true;

  }
  //calculateHermiteSurface(t);
  renderer.render(scene, sceneCamera);
}

const drawLines = () => {

  for (let i = 0; i < editor.controlPointMatrix.length; i++) {
    for (let j = 0; j < editor.controlPointMatrix[i].length - 1; j++) {

      let p1 = editor.controlPointMatrix[i][j];
      let p2 = editor.controlPointMatrix[i][j + 1];

      var p1VTanPosDirX = (p1.vTangents.posDir.x * 100 + p1.x * editor.boundingRect.width) / editor.boundingRect.width;
      var p1VTanPosDirY = (p1.vTangents.posDir.y * 100 + p1.y * editor.boundingRect.height) / editor.boundingRect.height;
      var p2VTanNegDirX = (p2.vTangents.negDir.x * -100 + p2.x * editor.boundingRect.width) / editor.boundingRect.width;
      var p2VTanNegDirY = (p2.vTangents.negDir.y * -100 + p2.y * editor.boundingRect.height) / editor.boundingRect.height;

      let curve = new THREE.CubicBezierCurve3(
        new THREE.Vector3(p1.x, p1.y, 1),
        new THREE.Vector3(p1VTanPosDirX, p1VTanPosDirY, 1),
        new THREE.Vector3(p2VTanNegDirX, p2VTanNegDirY, 1),
        new THREE.Vector3(p2.x, p2.y, 1)
      );

      //window.postMessage("nativeLog", "creating line")
      let geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
      let curveObject = new THREE.Line(geometry, coolmaterial);
      curveObject.curve = curve;
      scene.add(curveObject);
      verticalLines.set(i + "," + j, curveObject);
    }
  }

  for (let i = 0; i < editor.controlPointMatrix.length - 1; i++) {
    for (let j = 0; j < editor.controlPointMatrix[i].length; j++) {

      let p1 = editor.controlPointMatrix[i][j];
      let p2 = editor.controlPointMatrix[i + 1][j];

      var p1UTanPosDirX = (p1.uTangents.posDir.x * 100 + p1.x * editor.boundingRect.width) / editor.boundingRect.width;
      var p1UTanPosDirY = (p1.uTangents.posDir.y * 100 + p1.y * editor.boundingRect.height) / editor.boundingRect.height;
      var p2UTanNegDirX = (p2.uTangents.negDir.x * -100 + p2.x * editor.boundingRect.width) / editor.boundingRect.width;
      var p2UTanNegDirY = (p2.uTangents.negDir.y * -100 + p2.y * editor.boundingRect.height) / editor.boundingRect.height;

      let curve = new THREE.CubicBezierCurve3(
        new THREE.Vector3(p1.x, p1.y, 1),
        new THREE.Vector3(p1UTanPosDirX, p1UTanPosDirY, 1),
        new THREE.Vector3(p2UTanNegDirX, p2UTanNegDirY, 1),
        new THREE.Vector3(p2.x, p2.y, 1)
      );

      //window.postMessage("nativeLog", "creating line")
      let geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
      let curveObject = new THREE.Line(geometry, coolmaterial);
      curveObject.curve = curve;
      scene.add(curveObject);
      horizontalLines.set(i + "," + j, curveObject);
    }
  }

  calculateHermiteSurface();
  renderer.render(scene, sceneCamera);
}

const updateCPlines = () => {
  if (editor.selectedCp != null) {

    let i = editor.pointsMap.get(editor.selectedCp).i;
    let j = editor.pointsMap.get(editor.selectedCp).j;

    if (horizontalLines.has(i + "," + j)) {
      let curveObject = horizontalLines.get(i + "," + j)

      var p1UTanPosDirX = (editor.selectedCp.uTangents.posDir.x * 100 + editor.selectedCp.x * editor.boundingRect.width) / editor.boundingRect.width;
      var p1UTanPosDirY = (editor.selectedCp.uTangents.posDir.y * 100 + editor.selectedCp.y * editor.boundingRect.height) / editor.boundingRect.height;

      curveObject.curve.v0.set(editor.selectedCp.x, editor.selectedCp.y, 1)
      curveObject.curve.v1.set(p1UTanPosDirX, p1UTanPosDirY, 0)
      curveObject.geometry.setFromPoints(curveObject.curve.getPoints(50));
      curveObject.geometry.attributes.position.needsUpdate = true;
    }

    if (horizontalLines.has((i - 1) + "," + j)) {
      let curveObject = horizontalLines.get((i - 1) + "," + j)

      var p2UTanNegDirX = (editor.selectedCp.uTangents.negDir.x * -100 + editor.selectedCp.x * editor.boundingRect.width) / editor.boundingRect.width;
      var p2UTanNegDirY = (editor.selectedCp.uTangents.negDir.y * -100 + editor.selectedCp.y * editor.boundingRect.height) / editor.boundingRect.height;

      curveObject.curve.v2.set(p2UTanNegDirX, p2UTanNegDirY, 0)
      curveObject.curve.v3.set(editor.selectedCp.x, editor.selectedCp.y, 1)
      curveObject.geometry.setFromPoints(curveObject.curve.getPoints(50));
      curveObject.geometry.attributes.position.needsUpdate = true;
    }

    if (verticalLines.has(i + "," + j)) {
      let curveObject = verticalLines.get(i + "," + j)

      var p1VTanPosDirX = (editor.selectedCp.vTangents.posDir.x * 100 + editor.selectedCp.x * editor.boundingRect.width) / editor.boundingRect.width;
      var p1VTanPosDirY = (editor.selectedCp.vTangents.posDir.y * 100 + editor.selectedCp.y * editor.boundingRect.height) / editor.boundingRect.height;

      curveObject.curve.v0.set(editor.selectedCp.x, editor.selectedCp.y, 1)
      curveObject.curve.v1.set(p1VTanPosDirX, p1VTanPosDirY, 0)
      curveObject.geometry.setFromPoints(curveObject.curve.getPoints(50));
      curveObject.geometry.attributes.position.needsUpdate = true;
    }

    if (verticalLines.has(i + "," + (j - 1))) {
      let curveObject = verticalLines.get(i + "," + (j - 1))

      var p2VTanNegDirX = (editor.selectedCp.vTangents.negDir.x * -100 + editor.selectedCp.x * editor.boundingRect.width) / editor.boundingRect.width;
      var p2VTanNegDirY = (editor.selectedCp.vTangents.negDir.y * -100 + editor.selectedCp.y * editor.boundingRect.height) / editor.boundingRect.height;

      curveObject.curve.v2.set(p2VTanNegDirX, p2VTanNegDirY, 0)
      curveObject.curve.v3.set(editor.selectedCp.x, editor.selectedCp.y, 1)
      curveObject.geometry.setFromPoints(curveObject.curve.getPoints(50));
      curveObject.geometry.attributes.position.needsUpdate = true;
    }

    //TODO

    // var p1VTanPosDirX = (p1.vTangents.posDir.x * 100 + p1.x * editor.boundingRect.width) / editor.boundingRect.width;
    // var p1VTanPosDirY = (p1.vTangents.posDir.y * 100 + p1.y * editor.boundingRect.height) / editor.boundingRect.height;
    // var p2VTanNegDirX = (p2.vTangents.negDir.x * -100 + p2.x * editor.boundingRect.width) / editor.boundingRect.width;
    // var p2VTanNegDirY = (p2.vTangents.negDir.y * -100 + p2.y * editor.boundingRect.height) / editor.boundingRect.height;

    // let curve = new THREE.CubicBezierCurve3(
    //   new THREE.Vector3(p1.x, p1.y, 0),
    //   new THREE.Vector3(p1VTanPosDirX, p1VTanPosDirY, 0),
    //   new THREE.Vector3(p2VTanNegDirX, p2VTanNegDirY, 0),
    //   new THREE.Vector3(p2.x, p2.y, 0)
    // );

    // window.postMessage("nativeLog", "creating line")
    // let geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
    // let curveObject = new THREE.Line(geometry, coolmaterial);
    // curveObject.curve = curve;
    // scene.add(curveObject);
    // verticalLines.set(i + "," + j, curveObject);

  }


}


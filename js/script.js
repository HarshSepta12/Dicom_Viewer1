
// harsh
// Check if all required libraries are loaded
if (typeof cornerstone === "undefined") {
  console.error("Cornerstone not loaded");
}
if (typeof cornerstoneTools === "undefined") {
  console.error("CornerstoneTools not loaded");
}
if (typeof cornerstoneWADOImageLoader === "undefined") {
  console.error("CornerstoneWADOImageLoader not loaded");
}
if (typeof dicomParser === "undefined") {
  console.error("DicomParser not loaded");
}

// Initialize Cornerstone Tools
if (typeof cornerstoneTools !== "undefined") {
  cornerstoneTools.external.Hammer =
    typeof Hammer !== "undefined" ? Hammer : undefined;
  cornerstoneTools.external.cornerstone = cornerstone;
  cornerstoneTools.external.cornerstoneMath =
    typeof cornerstoneMath !== "undefined" ? cornerstoneMath : undefined;
  cornerstoneTools.init({
    showSVGCursors: true,
  });
}

// Initialize WADO Image Loader
if (typeof cornerstoneWADOImageLoader !== "undefined") {
  cornerstoneWADOImageLoader.external.dicomParser = dicomParser;
  cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
}

let allSeries = {};
let currentSeriesId = null;
let currentImageIndex = 0;
let loaded = false;
let activeViewport = null;
const API_BASE = "http://localhost:5000/orthanc";
const headers = {
  "Content-Type": "application/json",
};

// Add basic auth if credentials exist
const username = sessionStorage.getItem("pacsUsername");
const password = sessionStorage.getItem("pacsPassword");
if (username && password) {
  headers["Authorization"] = "Basic " + btoa(username + ":" + password);
}

const urlParams = new URLSearchParams(window.location.search);
const studyId = urlParams.get("study");

// Cine playback variables
let isPlaying = false;
let playbackInterval = null;
let playbackSpeed = 1;
let isLooping = true;
let playDirection = 1; // 1 for forward, -1 for backward

// Grid layout variables
let currentLayout = "1x1";
let gridViewports = [];
let activeGridViewport = 0;
let currentSeriesImages = [];

// DOM elements
const viewport = document.getElementById("viewport");
const dicomImage = document.getElementById("dicomImage");
const emptyState = document.getElementById("emptyState");
const uploadArea = document.getElementById("uploadArea");
const seriesContainer = document.getElementById("seriesContainer");
const loadingOverlay = document.getElementById("loadingOverlay");
const statusText = document.getElementById("statusText");
const loadingText = document.getElementById("loadingText");

// Cine control elements
const cineControls = document.getElementById("cineControls");
const playPauseBtn = document.getElementById("playPauseBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const firstBtn = document.getElementById("firstBtn");
const lastBtn = document.getElementById("lastBtn");
const loopBtn = document.getElementById("loopBtn");
const progressBar = document.getElementById("progressBar");
const progressFill = document.getElementById("progressFill");
const progressThumb = document.getElementById("progressThumb");
const currentTimeDisplay = document.getElementById("currentTime");
const totalTimeDisplay = document.getElementById("totalTime");

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  console.log("DOM Content Loaded");

  // Enable cornerstone on the main viewport
  if (typeof dicomImage !== "undefined" && dicomImage) {
    cornerstone.enable(dicomImage);
    activeViewport = dicomImage;
  }

  // Setup event listeners
  setupEventListeners();

  // Check if we have DICOM data from folder manager
  const hasDicomData = sessionStorage.getItem("hasDicomData");
  const folderId = sessionStorage.getItem("selectedFolderId");
  const dataSource = sessionStorage.getItem("dataSource");

  if (hasDicomData === "true" && folderId) {
    if (dataSource === "pacs") {
      loadPacsData(folderId);
    } else {
      loadDicomFromIndexedDB(folderId);
    }
  }
});


// ====================== WORKING 3D MPR USING 2D CORNERSTONE ======================
let mpr3dAvailable = true; // We'll make our own 3D MPR
let currentMPRLayout = null;

// Enhanced MPR State - integrate from mpr.js and mpr2.js
const mprState = {
  isActive: false,
  currentSeries: null,
  currentImageIndex: 0,
  viewports: {
    axial: null,
    sagittal: null,
    coronal: null
  },
  crosshair: { x: 0, y: 0, z: 0 },
  syncEnabled: true,
  
  // Enhanced from library files
  pixelData: [],
  pixelData2: [],
  imageStack: [],
  rotateSpeed: 5,
  maxLength: 0,
  center: { x: 0, y: 0, z: 0 },
  thicknessList: [],
  thickness: 0,
  pointX: 0,
  pointY: 0,
  bufferX: 0,
  bufferY: 0
};

// Global MPR variables from library
var openMPR = false;
var openMPR2 = false;
var o3dPixelData = [];
var o3dPixelData2 = [];
var o3dImage = [];
var o3dRotateSpeed = 5;
var o3dMaxLen;
var o3dCenter;
var thicknessList_MPR = [];
var Thickness_MPR = 0;
var o3DPointX = 0;
var o3DPointY = 0;
var buffer_mpr_X = 0;
var buffer_mpr_Y = 0;

// Enhanced activateMPR3D function integrating library features
function activateMPR3D() {
  console.log('Activating Enhanced 3D MPR...');
  
  if (!currentSeriesId || !allSeries[currentSeriesId]?.images?.length) {
    alert("No series loaded to activate 3D MPR");
    return;
  }

  const series = allSeries[currentSeriesId];
  if (series.images.length < 3) {
    alert("Need at least 3 images for MPR view");
    return;
  }

  try {
    // Set global flags
    openMPR = true;
    openMPR2 = true;
    
    // Hide 2D viewer and show MPR container
    document.getElementById("viewportContainer").style.display = "none";
    const mprContainer = document.getElementById("mprContainer");
    mprContainer.style.display = "grid";
    mprContainer.style.height = "100%";
    
    // Store current state
    mprState.isActive = true;
    mprState.currentSeries = series;
    mprState.currentImageIndex = currentImageIndex;
    
    // Initialize pixel data arrays from library functionality
    initializeMPRData(series);
    
    // Set up the three MPR viewports with enhanced features
    setupEnhancedMPRViewports();
    
    console.log("Enhanced 3D MPR activated successfully");
  } catch (error) {
    console.error('Error activating Enhanced MPR:', error);
    alert('Failed to activate Enhanced MPR: ' + error.message);
    
    // Revert on error
    deactivateMPR3D();
  }
}

function setupEnhancedMPRViewports() {
  const series = mprState.currentSeries;
  const totalImages = series.images.length;
  
  // Calculate indices for different views
  const axialIndex = mprState.currentImageIndex;
  const sagittalIndex = Math.floor(totalImages / 2);
  const coronalIndex = Math.floor(totalImages * 0.3);
  
  // Get viewport elements
  const axialElement = document.getElementById("mprAxial");
  const sagittalElement = document.getElementById("mprSagittal");
  const coronalElement = document.getElementById("mprCoronal");
  
  // Add enhanced labels with crosshair info
  addEnhancedMPRLabels();
  
  // Enable cornerstone on all elements
  try {
    cornerstone.enable(axialElement);
    cornerstone.enable(sagittalElement);
    cornerstone.enable(coronalElement);
  } catch (e) {
    console.log("Elements already enabled");
  }
  
  // Load images with enhanced processing
  Promise.all([
    loadEnhancedMPRImage(axialElement, axialIndex, 'axial'),
    loadEnhancedMPRImage(sagittalElement, sagittalIndex, 'sagittal'),
    loadEnhancedMPRImage(coronalElement, coronalIndex, 'coronal')
  ]).then(() => {
    // Store viewport references
    mprState.viewports.axial = axialElement;
    mprState.viewports.sagittal = sagittalElement;
    mprState.viewports.coronal = coronalElement;
    
    // Setup enhanced sync and interaction
    setupEnhancedMPRSync();
    
    // Draw crosshairs on all viewports
    drawCrosshairs();
    
  }).catch(error => {
    console.error('Error loading Enhanced MPR images:', error);
  });
}

// Enhanced image loading with crosshair integration
async function loadEnhancedMPRImage(element, imageIndex, orientation) {
  const series = mprState.currentSeries;
  const image = await cornerstone.loadImage(series.images[imageIndex].imageId);
  
  // Display the image
  cornerstone.displayImage(element, image);
  
  // Add orientation-specific processing from library
  if (orientation === 'axial') {
    // Process axial view with library functions
    processAxialView(element, image, imageIndex);
  } else if (orientation === 'sagittal') {
    // Process sagittal view
    processSagittalView(element, image, imageIndex);
  } else if (orientation === 'coronal') {
    // Process coronal view
    processCoronalView(element, image, imageIndex);
  }
  
  return image;
}

// Process different MPR orientations (from library integration)
function processAxialView(element, image, index) {
  // Extract pixel data for axial processing
  if (image.data && image.data.pixelData) {
    o3dPixelData[index] = new Uint16Array(image.data.pixelData);
  }
  
  // Apply axial-specific transformations
  const viewport = cornerstone.getViewport(element);
  viewport.rotation = 0; // Axial default rotation
  cornerstone.setViewport(element, viewport);
}

function processSagittalView(element, image, index) {
  // Extract pixel data for sagittal processing
  if (image.data && image.data.pixelData) {
    o3dPixelData2[index] = new Uint16Array(image.data.pixelData);
  }
  
  // Apply sagittal-specific transformations
  const viewport = cornerstone.getViewport(element);
  viewport.rotation = 90; // Sagittal rotation
  cornerstone.setViewport(element, viewport);
}



function processCoronalView(element, image, index) {
  // Apply coronal-specific transformations
  const viewport = cornerstone.getViewport(element);
  viewport.rotation = 0; // Coronal rotation
  viewport.hflip = true; // Flip horizontally for coronal view
  cornerstone.setViewport(element, viewport);
}

// Enhanced MPR synchronization from library
function setupEnhancedMPRSync() {
  const series = mprState.currentSeries;
  
  // Add enhanced scroll functionality
  Object.entries(mprState.viewports).forEach(([orientation, element]) => {
    if (!element) return;
    
    // Remove existing handlers
    if (element._mprScrollHandler) {
      element.removeEventListener('wheel', element._mprScrollHandler);
    }
    if (element._mprClickHandler) {
      element.removeEventListener('click', element._mprClickHandler);
    }
    if (element._mprMoveHandler) {
      element.removeEventListener('mousemove', element._mprMoveHandler);
    }
    
    // Enhanced scroll handler with library integration
    element._mprScrollHandler = function(event) {
      event.preventDefault();
      
      const delta = event.deltaY > 0 ? 1 : -1;
      let newIndex = mprState.currentImageIndex + delta;
      
      // Clamp to valid range
      newIndex = Math.max(0, Math.min(series.images.length - 1, newIndex));
      
      if (newIndex !== mprState.currentImageIndex) {
        mprState.currentImageIndex = newIndex;
        updateEnhancedMPRSlice(orientation, newIndex);
        
        // Update crosshair position based on library logic
        if (orientation === 'axial') {
          updateCrosshairPosition(o3DPointX, o3DPointY, newIndex);
        }
      }
    };
    
    // Enhanced click handler for crosshair positioning
    element._mprClickHandler = function(event) {
      const rect = element.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;
      
      // Convert click coordinates to image coordinates
      const imageX = Math.floor((clickX / rect.width) * (element.clientWidth || 512));
      const imageY = Math.floor((clickY / rect.height) * (element.clientHeight || 512));
      
      // Update crosshair position using library logic
      updateCrosshairFromClick(orientation, imageX, imageY);
    };
    
    // Enhanced mouse move handler for real-time crosshair
    element._mprMoveHandler = function(event) {
      if (event.buttons === 1) { // Left mouse button pressed
        const rect = element.getBoundingClientRect();
        const moveX = event.clientX - rect.left;
        const moveY = event.clientY - rect.top;
        
        // Update buffer positions from library
        buffer_mpr_X = moveX;
        buffer_mpr_Y = moveY;
        
        // Redraw crosshairs
        drawCrosshairs();
      }
    };
    
    // Attach enhanced event listeners
    element.addEventListener('wheel', element._mprScrollHandler);
    element.addEventListener('click', element._mprClickHandler);
    element.addEventListener('mousemove', element._mprMoveHandler);
  });
}

// Enhanced slice update with library integration
function updateEnhancedMPRSlice(changedViewport, newIndex) {
  const series = mprState.currentSeries;
  
  // Update the specific viewport that changed
  const element = mprState.viewports[changedViewport];
  if (element) {
    loadEnhancedMPRImage(element, newIndex, changedViewport);
  }
  
  // Sync with other viewports if enabled
  if (mprState.syncEnabled) {
    // Update other viewports based on crosshair position
    syncMPRViewportsFromLibrary(changedViewport, newIndex);
  }
  
  // Update main 2D viewer index
  currentImageIndex = newIndex;
  
  // Redraw crosshairs on all viewports
  drawCrosshairs();
}

// Synchronize viewports using library logic
function syncMPRViewportsFromLibrary(sourceViewport, sourceIndex) {
  const crosshairX = o3DPointX;
  const crosshairY = o3DPointY;
  const crosshairZ = sourceIndex;
  
  // Update other viewports based on crosshair position
  Object.entries(mprState.viewports).forEach(([orientation, element]) => {
    if (orientation === sourceViewport || !element) return;
    
    let targetIndex;
    if (orientation === 'axial') {
      targetIndex = crosshairZ;
    } else if (orientation === 'sagittal') {
      targetIndex = Math.floor((crosshairX / o3dMaxLen) * mprState.currentSeries.images.length);
    } else if (orientation === 'coronal') {
      targetIndex = Math.floor((crosshairY / o3dMaxLen) * mprState.currentSeries.images.length);
    }
    
    // Clamp and update
    targetIndex = Math.max(0, Math.min(mprState.currentSeries.images.length - 1, targetIndex));
    loadEnhancedMPRImage(element, targetIndex, orientation);
  });
}

// Initialize MPR data structures from library
function initializeMPRData(series) {
  o3dPixelData = [];
  o3dPixelData2 = [];
  o3dImage = [];
  thicknessList_MPR = [];
  
  // Process each image in the series
  series.images.forEach((image, index) => {
    // Store image references for MPR processing
    o3dImage[index] = image;
    
    // Initialize pixel data arrays for each image
    o3dPixelData[index] = [];
    o3dPixelData2[index] = [];
    
    // Calculate thickness for each slice
    thicknessList_MPR[index] = 1; // Default thickness
  });
  
  // Calculate center point and max length
  o3dMaxLen = Math.max(series.images.length, 256);
  o3dCenter = {
    x: Math.floor(o3dMaxLen / 2),
    y: Math.floor(o3dMaxLen / 2),
    z: Math.floor(series.images.length / 2)
  };
  
  // Set initial crosshair position
  o3DPointX = o3dCenter.x;
  o3DPointY = o3dCenter.y;
  
  mprState.center = o3dCenter;
  mprState.maxLength = o3dMaxLen;
}


// Enhanced crosshair drawing from library
function drawCrosshairs() {
  Object.entries(mprState.viewports).forEach(([orientation, element]) => {
    if (!element) return;
    
    // Remove existing crosshairs
    const existingCrosshairs = element.querySelectorAll('.mpr-crosshair');
    existingCrosshairs.forEach(ch => ch.remove());
    
    // Draw new crosshairs
    const crosshairContainer = document.createElement('div');
    crosshairContainer.className = 'mpr-crosshair';
    crosshairContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 5;
    `;
    
    // Calculate crosshair position based on orientation
    let crosshairX, crosshairY;
    if (orientation === 'axial') {
      crosshairX = (o3DPointX / o3dMaxLen) * 100;
      crosshairY = (o3DPointY / o3dMaxLen) * 100;
    } else if (orientation === 'sagittal') {
      crosshairX = (buffer_mpr_X / element.clientWidth) * 100;
      crosshairY = (mprState.currentImageIndex / mprState.currentSeries.images.length) * 100;
    } else if (orientation === 'coronal') {
      crosshairX = (o3DPointX / o3dMaxLen) * 100;
      crosshairY = (mprState.currentImageIndex / mprState.currentSeries.images.length) * 100;
    }
    
    // Create horizontal and vertical lines
    const hLine = document.createElement('div');
    hLine.style.cssText = `
      position: absolute;
      top: ${crosshairY}%;
      left: 0;
      width: 100%;
      height: 1px;
      background: #00ff00;
      box-shadow: 0 0 2px rgba(0,255,0,0.8);
    `;
    
    const vLine = document.createElement('div');
    vLine.style.cssText = `
      position: absolute;
      top: 0;
      left: ${crosshairX}%;
      width: 1px;
      height: 100%;
      background: #00ff00;
      box-shadow: 0 0 2px rgba(0,255,0,0.8);
    `;
    
    crosshairContainer.appendChild(hLine);
    crosshairContainer.appendChild(vLine);
    element.appendChild(crosshairContainer);
  });
}

// Update crosshair position from click
function updateCrosshairFromClick(orientation, imageX, imageY) {
  if (orientation === 'axial') {
    o3DPointX = Math.floor((imageX / 512) * o3dMaxLen);
    o3DPointY = Math.floor((imageY / 512) * o3dMaxLen);
  } else if (orientation === 'sagittal') {
    buffer_mpr_X = imageX;
    // Update Z position based on Y click
    const newZ = Math.floor((imageY / 512) * mprState.currentSeries.images.length);
    mprState.currentImageIndex = Math.max(0, Math.min(mprState.currentSeries.images.length - 1, newZ));
  } else if (orientation === 'coronal') {
    o3DPointX = Math.floor((imageX / 512) * o3dMaxLen);
    // Update Z position based on Y click
    const newZ = Math.floor((imageY / 512) * mprState.currentSeries.images.length);
    mprState.currentImageIndex = Math.max(0, Math.min(mprState.currentSeries.images.length - 1, newZ));
  }
  
  // Sync all viewports and redraw crosshairs
  syncMPRViewportsFromLibrary(orientation, mprState.currentImageIndex);
  drawCrosshairs();
}

// Update crosshair position function - Add this to your script
function updateCrosshairPosition(x, y, z) {
  console.log('Updating crosshair position:', { x, y, z });
  
  // Update global crosshair coordinates
  o3DPointX = x;
  o3DPointY = y;
  mprState.currentImageIndex = z;
  
  // Update mprState crosshair object
  mprState.crosshair.x = x;
  mprState.crosshair.y = y;
  mprState.crosshair.z = z;
  
  // Only update if MPR is active
  if (!mprState.isActive) return;
  
  // Redraw crosshairs on all viewports
  drawCrosshairs();
  
  // Update position labels on each viewport
  Object.entries(mprState.viewports).forEach(([orientation, element]) => {
    if (element && element._updatePosition) {
      element._updatePosition();
    }
  });
  
  // Update any additional UI elements that show position info
  updateMPRPositionDisplay();
}

// Additional helper function to update position displays
function updateMPRPositionDisplay() {
  // Update position labels in MPR viewports
  const axialLabel = document.querySelector('#mprAxial .mpr-position-label');
  const sagittalLabel = document.querySelector('#mprSagittal .mpr-position-label');
  const coronalLabel = document.querySelector('#mprCoronal .mpr-position-label');
  
  if (axialLabel) {
    axialLabel.textContent = `Z: ${mprState.currentImageIndex + 1}/${mprState.currentSeries?.images?.length || 0}`;
  }
  
  if (sagittalLabel) {
    sagittalLabel.textContent = `X: ${o3DPointX}/${o3dMaxLen}`;
  }
  
  if (coronalLabel) {
    coronalLabel.textContent = `Y: ${o3DPointY}/${o3dMaxLen}`;
  }
  
  console.log('MPR position updated:', {
    x: o3DPointX,
    y: o3DPointY,
    z: mprState.currentImageIndex,
    maxLen: o3dMaxLen
  });
}

// Enhanced crosshair centering from library
function centerCrosshairToVolume() {
  if (!mprState.isActive) return;
  
  const series = mprState.currentSeries;
  
  // Center crosshair using library logic
  o3DPointX = o3dCenter.x;
  o3DPointY = o3dCenter.y;
  mprState.currentImageIndex = o3dCenter.z;
  
  // Reset buffer positions
  buffer_mpr_X = 0;
  buffer_mpr_Y = 0;
  
  // Update all viewports
  Object.entries(mprState.viewports).forEach(([orientation, element]) => {
    if (element) {
      const centerIndex = orientation === 'axial' ? o3dCenter.z : 
                         orientation === 'sagittal' ? o3dCenter.x : 
                         o3dCenter.y;
      loadEnhancedMPRImage(element, Math.min(centerIndex, series.images.length - 1), orientation);
    }
  });
  
  // Redraw crosshairs
  drawCrosshairs();
  
  console.log("MPR crosshair centered using library logic");
}

function addEnhancedMPRLabels() {
  const viewports = ['mprAxial', 'mprSagittal', 'mprCoronal'];
  const labels = ['Axial', 'Sagittal', 'Coronal'];
  
  viewports.forEach((viewportId, index) => {
    const element = document.getElementById(viewportId);
    if (element) {
      // Remove existing label
      const existingLabel = element.querySelector('.mpr-label');
      if (existingLabel) existingLabel.remove();
      
      // Add enhanced label with position info
      const label = document.createElement('div');
      label.className = 'mpr-label';
      label.textContent = labels[index];
      label.style.cssText = `
        position: absolute;
        top: 5px;
        left: 5px;
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 4px 8px;
        border-radius: 3px;
        font-size: 12px;
        z-index: 10;
        border: 1px solid #00ff00;
      `;
      element.appendChild(label);
      
      // Add position info label
      const positionLabel = document.createElement('div');
      positionLabel.className = 'mpr-position-label';
      positionLabel.style.cssText = `
        position: absolute;
        top: 5px;
        right: 5px;
        background: rgba(0,0,0,0.8);
        color: #00ff00;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 10px;
        z-index: 10;
        font-family: monospace;
      `;
      
      // Update position based on orientation
      const updatePosition = () => {
        if (labels[index] === 'Axial') {
          positionLabel.textContent = `Z: ${mprState.currentImageIndex + 1}/${mprState.currentSeries?.images?.length || 0}`;
        } else if (labels[index] === 'Sagittal') {
          positionLabel.textContent = `X: ${o3DPointX}/${o3dMaxLen}`;
        } else {
          positionLabel.textContent = `Y: ${o3DPointY}/${o3dMaxLen}`;
        }
      };
      
      updatePosition();
      element.appendChild(positionLabel);
      
      // Store update function for later use
      element._updatePosition = updatePosition;
    }
  });
}

function deactivateMPR3D() {
  if (!mprState.isActive) return;
  
  // Set global flags
  openMPR = false;
  openMPR2 = false;
  
  // Clean up pixel data arrays
  o3dPixelData = [];
  o3dPixelData2 = [];
  o3dImage = [];
  thicknessList_MPR = [];
  
  // Disable cornerstone on MPR elements and clean up
  Object.values(mprState.viewports).forEach(element => {
    if (element) {
      try {
        // Remove all event handlers
        if (element._mprScrollHandler) {
          element.removeEventListener('wheel', element._mprScrollHandler);
          delete element._mprScrollHandler;
        }
        if (element._mprClickHandler) {
          element.removeEventListener('click', element._mprClickHandler);
          delete element._mprClickHandler;
        }
        if (element._mprMoveHandler) {
          element.removeEventListener('mousemove', element._mprMoveHandler);
          delete element._mprMoveHandler;
        }
        
        // Remove crosshairs
        const crosshairs = element.querySelectorAll('.mpr-crosshair');
        crosshairs.forEach(ch => ch.remove());
        
        // Remove labels
        const labels = element.querySelectorAll('.mpr-label, .mpr-position-label');
        labels.forEach(label => label.remove());
        
        // Disable cornerstone
        cornerstone.disable(element);
      } catch (e) {
        console.log("Element cleanup error:", e);
      }
    }
  });
  
  // Hide MPR container and show 2D viewer
  document.getElementById("mprContainer").style.display = "none";
  document.getElementById("viewportContainer").style.display = "block";
  
  // Reset state
  mprState.isActive = false;
  mprState.viewports = { axial: null, sagittal: null, coronal: null };
  
  // Reset library variables
  o3DPointX = 0;
  o3DPointY = 0;
  buffer_mpr_X = 0;
  buffer_mpr_Y = 0;
  
  console.log("Enhanced MPR deactivated");
}




function setupMPRViewports() {
  const series = mprState.currentSeries;
  const totalImages = series.images.length;
  const middleIndex = Math.floor(totalImages / 2);
  
  // Calculate indices for different views
  const axialIndex = mprState.currentImageIndex;
  const sagittalIndex = Math.min(middleIndex, totalImages - 1);
  const coronalIndex = Math.max(0, Math.floor(totalImages * 0.3));
  
  // Setup Axial view (current slice)
  const axialElement = document.getElementById("mprAxial");
  const sagittalElement = document.getElementById("mprSagittal");
  const coronalElement = document.getElementById("mprCoronal");
  
  // Add labels to viewports
  addMPRLabels();
  
  // Enable cornerstone on all elements
  try {
    cornerstone.enable(axialElement);
    cornerstone.enable(sagittalElement);
    cornerstone.enable(coronalElement);
  } catch (e) {
    // Elements might already be enabled
  }
  
  // Load images into viewports
  Promise.all([
    cornerstone.loadImage(series.images[axialIndex].imageId),
    cornerstone.loadImage(series.images[sagittalIndex].imageId),
    cornerstone.loadImage(series.images[coronalIndex].imageId)
  ]).then(([axialImage, sagittalImage, coronalImage]) => {
    
    // Display images
    cornerstone.displayImage(axialElement, axialImage);
    cornerstone.displayImage(sagittalElement, sagittalImage);
    cornerstone.displayImage(coronalElement, coronalImage);
    
    // Store viewport references
    mprState.viewports.axial = axialElement;
    mprState.viewports.sagittal = sagittalElement;
    mprState.viewports.coronal = coronalElement;
    
    // Setup cross-references and sync
    setupMPRSync();
    
  }).catch(error => {
    console.error('Error loading MPR images:', error);
  });
}

function addMPRLabels() {
  // Add labels to each viewport
  const viewports = ['mprAxial', 'mprSagittal', 'mprCoronal'];
  const labels = ['Axial', 'Sagittal', 'Coronal'];
  
  viewports.forEach((viewportId, index) => {
    const element = document.getElementById(viewportId);
    if (element) {
      // Remove existing label
      const existingLabel = element.querySelector('.mpr-label');
      if (existingLabel) existingLabel.remove();
      
      // Add new label
      const label = document.createElement('div');
      label.className = 'mpr-label';
      label.textContent = labels[index];
      label.style.cssText = `
        position: absolute;
        top: 5px;
        left: 5px;
        background: rgba(0,0,0,0.7);
        color: white;
        padding: 2px 8px;
        border-radius: 3px;
        font-size: 12px;
        z-index: 10;
      `;
      element.appendChild(label);
    }
  });
}

function setupMPRSync() {
  const series = mprState.currentSeries;
  
  // Add scroll functionality to navigate through slices
  Object.values(mprState.viewports).forEach((element, index) => {
    if (!element) return;
    
    // Remove existing scroll listener
    if (element._mprScrollHandler) {
      element.removeEventListener('wheel', element._mprScrollHandler);
    }
    
    element._mprScrollHandler = function(event) {
      event.preventDefault();
      
      const viewportNames = ['axial', 'sagittal', 'coronal'];
      const currentViewport = viewportNames[index];
      
      // Calculate new slice index
      let newIndex = mprState.currentImageIndex;
      if (event.deltaY > 0) {
        newIndex = Math.min(series.images.length - 1, newIndex + 1);
      } else {
        newIndex = Math.max(0, newIndex - 1);
      }
      
      if (newIndex !== mprState.currentImageIndex) {
        mprState.currentImageIndex = newIndex;
        updateMPRSlice(currentViewport, newIndex);
      }
    };
    
    element.addEventListener('wheel', element._mprScrollHandler);
  });
}

function updateMPRSlice(changedViewport, newIndex) {
  const series = mprState.currentSeries;
  const imageId = series.images[newIndex].imageId;
  
  // Update the viewport that changed
  const element = mprState.viewports[changedViewport];
  if (element) {
    cornerstone.loadImage(imageId).then(image => {
      cornerstone.displayImage(element, image);
    });
  }
  
  // Optionally sync with other viewports (simplified)
  if (mprState.syncEnabled && changedViewport === 'axial') {
    // Update main 2D viewer index as well
    currentImageIndex = newIndex;
  }
}




function syncMPRViewports() {
  mprState.syncEnabled = !mprState.syncEnabled;
  
  const syncBtn = document.getElementById('mprSyncBtn');
  if (syncBtn) {
    syncBtn.style.opacity = mprState.syncEnabled ? '1' : '0.5';
    syncBtn.title = mprState.syncEnabled ? 'Sync Enabled' : 'Sync Disabled';
  }
  
  console.log("MPR sync:", mprState.syncEnabled ? "enabled" : "disabled");
}

// Setup MPR button
function setupMPRButton() {
  const mprButton = document.getElementById('mprTool');
  if (!mprButton) return;
  
  // Always enable since we're using 2D cornerstone
  mprButton.addEventListener('click', activateMPR3D);
  mprButton.title = 'MPR View (Multi-planar)';
  mprButton.style.opacity = '1';
  mprButton.style.background = 'rgba(59, 130, 246, 0.9)'; // Blue for working MPR
  
  console.log('✅ MPR enabled successfully!');
}

// Initialize MPR when DOM loads
document.addEventListener("DOMContentLoaded", function() {
  setupMPRButton();
  
  // Setup MPR control buttons
  const mprResetBtn = document.getElementById('mprResetBtn');
  const mprSyncBtn = document.getElementById('mprSyncBtn');
  const mprExitBtn = document.getElementById('mprExitBtn');
  
  if (mprResetBtn) mprResetBtn.addEventListener('click', centerCrosshairToVolume);
  if (mprSyncBtn) mprSyncBtn.addEventListener('click', syncMPRViewports);
  if (mprExitBtn) mprExitBtn.addEventListener('click', deactivateMPR3D);
});

// ====================== END WORKING 3D MPR ======================


// Load PACS data
async function loadPacsData(folderId) {
  showLoading(true, "Loading PACS study...");

  try {
    const pacsServerUrl = sessionStorage.getItem("pacsServerUrl");
    const studyId = sessionStorage.getItem("pacsStudyId");

    if (!pacsServerUrl || !studyId) {
      throw new Error("PACS server URL or study ID not found in session");
    }

    // Get authentication headers
    const headers = {
      "Content-Type": "application/json",
    };

    // Add basic auth if credentials exist
    const username = sessionStorage.getItem("pacsUsername");
    const password = sessionStorage.getItem("pacsPassword");
    if (username && password) {
      headers["Authorization"] = "Basic " + btoa(username + ":" + password);
    }

    // Get series list
    const seriesRes = await fetch(
      `${pacsServerUrl}/studies/${studyId}/series`,
      {
        method: "GET",
        headers: headers,
      }
    );

    if (!seriesRes.ok) {
      throw new Error(`Failed to fetch series: ${seriesRes.status}`);
    }

    const seriesList = await seriesRes.json();

    if (!seriesList || seriesList.length === 0) {
      throw new Error("No series found in study");
    }

    const tempSeries = {};
    let totalInstances = 0;

    // Process each series
    for (let i = 0; i < seriesList.length; i++) {
      const seriesData = seriesList[i];
      const seriesId = seriesData.ID;
      updateStatus(`Loading series ${i + 1}/${seriesList.length}...`);

      try {
        // Get series details
        const seriesDetailsRes = await fetch(
          `${pacsServerUrl}/studies/${studyId}`,
          {
            headers: headers,
          }
        );
        const seriesDetails = await seriesDetailsRes.json();

        // Get instances in this series
        const instancesRes = await fetch(
          `${pacsServerUrl}/series/${seriesId}/instances`,
          {
            headers: headers,
          }
        );
        const instances = await instancesRes.json();

        if (instances.length === 0) {
          console.warn(`No instances found in series ${seriesId}`);
          continue;
        }

        const seriesKey = `${studyId}_${seriesId}`;
        tempSeries[seriesKey] = {
          seriesInstanceUID: seriesId,
          studyInstanceUID: studyId,
          patientName:
            seriesDetails.PatientMainDicomTags?.PatientName ||
            "Unknown Patient",
          studyDescription:
            seriesDetails.MainDicomTags?.StudyDescription || "PACS Study",
          seriesDescription:
            seriesDetails.MainDicomTags?.SeriesDescription || `Series ${i + 1}`,
          seriesNumber: seriesDetails.MainDicomTags?.SeriesNumber || i + 1,
          studyDate: formatDate(seriesDetails.MainDicomTags?.StudyDate || ""),
          studyTime: formatTime(seriesDetails.MainDicomTags?.StudyTime || ""),
          modality: seriesDetails.MainDicomTags?.Modality || "UN",
          images: [],
        };

        // Process each instance
        for (let j = 0; j < instances.length; j++) {
          const instanceData = instances[j];
          const instanceId = instanceData.ID || instanceData.id;

          updateStatus(
            `Loading series ${i + 1}/${seriesList.length}, image ${j + 1}/${
              instances.length
            }...`
          );

          try {
            // Get DICOM file
            const fileRes = await fetch(
              `${pacsServerUrl}/instances/${instanceId}/file`,
              {
                headers: headers,
              }
            );

            if (!fileRes.ok) {
              console.warn(
                `Failed to fetch instance ${instanceId}: ${fileRes.status}`
              );
              continue;
            }

            const dicomArrayBuffer = await fileRes.arrayBuffer();
            const blob = new Blob([dicomArrayBuffer], {
              type: "application/dicom",
            });
            const imageId =
              cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);

            tempSeries[seriesKey].images.push({
              imageId: imageId,
              instanceNumber: j + 1,
              fileName: `${instanceId}.dcm`,
              patientName: tempSeries[seriesKey].patientName,
              studyDescription: tempSeries[seriesKey].studyDescription,
              seriesDescription: tempSeries[seriesKey].seriesDescription,
              studyDate: tempSeries[seriesKey].studyDate,
              studyTime: tempSeries[seriesKey].studyTime,
              modality: tempSeries[seriesKey].modality,
            });

            totalInstances++;
          } catch (instanceError) {
            console.error(
              `Error loading instance ${instanceId}:`,
              instanceError
            );
          }
        }

        // Sort images by instance number
        tempSeries[seriesKey].images.sort(
          (a, b) => a.instanceNumber - b.instanceNumber
        );
      } catch (seriesError) {
        console.error(`Error loading series ${seriesId}:`, seriesError);
      }
    }

    finalizeSeries(tempSeries, totalInstances);
  } catch (error) {
    console.error("Error loading PACS study:", error);
    showError("Failed to load PACS study: " + error.message);
    showLoading(false);
  }
}

// Setup all event listeners
function setupEventListeners() {
  // Cine control event listeners
  if (playPauseBtn) playPauseBtn.addEventListener("click", togglePlayback);
  if (prevBtn) prevBtn.addEventListener("click", () => changeImage(-1));
  if (nextBtn) nextBtn.addEventListener("click", () => changeImage(1));
  if (firstBtn) firstBtn.addEventListener("click", () => goToImage(0));
  if (lastBtn)
    lastBtn.addEventListener("click", () => {
      const series = allSeries[currentSeriesId];
      if (series) goToImage(series.images.length - 1);
    });
  if (loopBtn) loopBtn.addEventListener("click", toggleLoop);

  // Speed control buttons
  document.querySelectorAll(".speed-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const speed = parseFloat(btn.dataset.speed);
      if (speed) setPlaybackSpeed(speed);
    });
  });

  // Progress bar interactions
  if (progressBar) progressBar.addEventListener("click", handleProgressClick);

  // Dropdown functionality
  const annotationTool = document.getElementById("annotationTool");
  const layoutTool = document.getElementById("layoutTool");

  if (annotationTool) {
    annotationTool.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDropdown("annotationDropdown");
    });
  }

  if (layoutTool) {
    layoutTool.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDropdown("layoutDropdown");
    });
  }

  document.addEventListener("click", () => {
    closeAllDropdowns();
  });

  // Auto-hide cine controls
  let controlsTimeout;
  const viewerArea = document.querySelector(".viewer-area");

  function showCineControls() {
    if (cineControls) {
      cineControls.classList.remove("auto-hide");
      clearTimeout(controlsTimeout);

      controlsTimeout = setTimeout(() => {
        if (!isPlaying) {
          cineControls.classList.add("auto-hide");
        }
      }, 3000);
    }
  }

  function hideCineControls() {
    if (!isPlaying && cineControls) {
      cineControls.classList.add("auto-hide");
    }
  }

  if (viewerArea) {
    viewerArea.addEventListener("mousemove", showCineControls);
    viewerArea.addEventListener("mouseleave", hideCineControls);
  }

  if (cineControls) {
    cineControls.addEventListener("mouseenter", () => {
      clearTimeout(controlsTimeout);
      cineControls.classList.remove("auto-hide");
    });
  }
}

// Initialize IndexedDB connection
function initViewerDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("DICOM_DB", 1);

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

// Load DICOM data from IndexedDB - MAIN FUNCTION
async function loadDicomFromIndexedDB(folderId) {
  console.log("Loading DICOM data from IndexedDB for folder ID:", folderId);

  showLoading(true, "Loading DICOM data from IndexedDB...");

  try {
    const db = await initViewerDB();

    // First get folder metadata
    const folderData = await getFolderFromIndexedDB(db, folderId);
    if (!folderData) {
      throw new Error("Folder not found in IndexedDB");
    }

    // Then get all files for this folder
    const files = await getFilesFromIndexedDB(db, folderId);
    if (!files || files.length === 0) {
      throw new Error("No files found for this folder");
    }

    console.log("Found folder with", files.length, "files");

    // Process the files
    await processIndexedDBDicomFiles(folderData, files);
  } catch (error) {
    console.error("Error loading DICOM data from IndexedDB:", error);

    // Fallback to localStorage method
    console.log("Falling back to localStorage method...");
    loadDicomFromStorage(folderId);
  }
}

// Get folder data from IndexedDB
function getFolderFromIndexedDB(db, folderId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("folders", "readonly");
    const store = transaction.objectStore("folders");

    const request = store.get(parseInt(folderId));

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = (e) => {
      reject(e.target.error);
    };
  });
}

// Get files from IndexedDB
function getFilesFromIndexedDB(db, folderId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("dicomFiles", "readonly");
    const store = transaction.objectStore("dicomFiles");
    const files = [];

    store.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.folderId == folderId) {
          files.push(cursor.value);
        }
        cursor.continue();
      } else {
        resolve(files);
      }
    };

    store.openCursor().onerror = (e) => {
      reject(e.target.error);
    };
  });
}

// Process DICOM files from IndexedDB
async function processIndexedDBDicomFiles(folderData, files) {
  console.log("Processing DICOM files from IndexedDB...");

  const tempSeries = {};
  let processedFiles = 0;
  let validFiles = 0;

  for (let i = 0; i < files.length; i++) {
    const fileRecord = files[i];

    try {
      // Get the actual file data
      let dicomFile = fileRecord.data;

      // If data is not a File object, try to convert it
      if (!(dicomFile instanceof File)) {
        if (dicomFile instanceof ArrayBuffer) {
          dicomFile = new File([dicomFile], fileRecord.name, {
            type: fileRecord.type || "application/dicom",
          });
        } else {
          console.warn("Unsupported file data type for:", fileRecord.name);
          processedFiles++;
          continue;
        }
      }

      // Create cornerstone image ID
      const imageId =
        cornerstoneWADOImageLoader.wadouri.fileManager.add(dicomFile);

      // Create series grouping
      const seriesKey = "series_" + folderData.id;

      if (!tempSeries[seriesKey]) {
        tempSeries[seriesKey] = {
          seriesInstanceUID: seriesKey,
          studyInstanceUID: "study_" + folderData.id,
          patientName: folderData.patientName || "Unknown Patient",
          studyDescription: folderData.name || "Local Study",
          seriesDescription: folderData.type || "Local Series",
          seriesNumber: 1,
          studyDate: formatDate(folderData.date || ""),
          studyTime: folderData.studyTime || "00:00:00",
          modality: folderData.modality || "UN",
          images: [],
        };
      }

      tempSeries[seriesKey].images.push({
        imageId: imageId,
        instanceNumber: i + 1,
        fileName: fileRecord.name,
        patientName: folderData.patientName || "Unknown Patient",
        studyDescription: folderData.name || "Local Study",
        seriesDescription: folderData.type || "Local Series",
        studyDate: formatDate(folderData.date || ""),
        studyTime: folderData.studyTime || "00:00:00",
        modality: folderData.modality || "UN",
      });

      validFiles++;
      processedFiles++;

      const progress = (processedFiles / files.length) * 100;
      updateProgress(progress);

      if (typeof loadingText !== "undefined" && loadingText) {
        loadingText.textContent = `Loading images... (${processedFiles}/${files.length})`;
      }
    } catch (error) {
      console.error("Error processing file:", fileRecord.name, error);
      processedFiles++;
    }
  }

  // Finalize after all files are processed
  if (validFiles > 0) {
    finalizeSeries(tempSeries, validFiles);
  } else {
    throw new Error("No valid DICOM files could be loaded");
  }
}

// Load DICOM data from localStorage - MAIN FUNCTION
function loadDicomFromStorage(folderId) {
  console.log("Loading DICOM data for folder ID:", folderId);

  showLoading(true, "Loading DICOM data...");

  try {
    const saved = localStorage.getItem("dicomFolders");
    if (!saved) {
      throw new Error("No DICOM data found in localStorage");
    }

    const folders = JSON.parse(saved);
    const folder = folders.find((f) => f.id == folderId);
    console.log(folders);

    if (!folder) {
      throw new Error("Selected folder not found");
    }

    if (!folder.files || folder.files.length === 0) {
      throw new Error("No files found in folder");
    }

    console.log("Found folder with", folder.files.length, "files");

    // Check if files have base64 data
    const filesWithBase64 = folder.files.filter((file) => file.base64);
    if (filesWithBase64.length === 0) {
      throw new Error("No image data found. Please re-upload the folder.");
    }

    // Process the files
    processStoredDicomFiles(folder);
  } catch (error) {
    console.error("Error loading DICOM data:", error);
    showError(error.message);
    showLoading(false);
  }
}

function base64ToFile(base64String, fileName) {
  const arr = base64String.split(",");
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);

  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }

  return new File([u8arr], fileName, { type: mime });
}

// Process DICOM files from localStorage (legacy support)
function processStoredDicomFiles(folder) {
  const tempSeries = {};
  let processedFiles = 0;
  let validFiles = 0;

  folder.files.forEach((fileData, index) => {
    if (!fileData.base64) {
      console.warn("Skipping file without base64 data:", fileData.name);
      processedFiles++;
      return;
    }

    try {
      // Convert base64 back to file
      const dicomFile = base64ToFile(fileData.base64, fileData.name);
      const imageId =
        cornerstoneWADOImageLoader.wadouri.fileManager.add(dicomFile);

      // Create a fake series (since we don't have DICOM parsing)
      const seriesKey = "series_" + folder.id;

      if (!tempSeries[seriesKey]) {
        tempSeries[seriesKey] = {
          seriesInstanceUID: seriesKey,
          studyInstanceUID: "study_" + folder.id,
          patientName: folder.patientName || "Unknown Patient",
          studyDescription: folder.name || "Local Study",
          seriesDescription: folder.type || "Local Series",
          seriesNumber: 1,
          studyDate: formatDate(folder.date || ""),
          studyTime: "00:00:00",
          modality: "UN",
          images: [],
        };
      }

      tempSeries[seriesKey].images.push({
        imageId: imageId,
        instanceNumber: index + 1,
        fileName: fileData.name,
        patientName: folder.patientName || "Unknown Patient",
        studyDescription: folder.name || "Local Study",
        seriesDescription: folder.type || "Local Series",
        studyDate: formatDate(folder.date || ""),
        studyTime: "00:00:00",
        modality: "UN",
      });

      validFiles++;
      processedFiles++;

      const progress = (processedFiles / folder.files.length) * 100;
      updateProgress(progress);

      if (typeof loadingText !== "undefined" && loadingText) {
        loadingText.textContent = `Loading images... (${processedFiles}/${folder.files.length})`;
      }
    } catch (error) {
      console.error("Error processing file:", fileData.name, error);
      processedFiles++;
    }

    // Check if all files processed
    if (processedFiles === folder.files.length) {
      finalizeSeries(tempSeries, validFiles);
    }
  });
}

// FIXED: Finalize series after processing
function finalizeSeries(tempSeries, validFiles) {
  if (validFiles === 0) {
    showError("No valid DICOM files found!");
    showLoading(false);
    return;
  }

  // Convert tempSeries to the correct format that the UI expects
  allSeries = {}; // Reset the global allSeries object

  // Convert each series in tempSeries to the expected format
  Object.keys(tempSeries).forEach((key) => {
    allSeries[key] = tempSeries[key];
  });

  // Create the series UI - this is the key fix!
  createSeriesUI();

  // Load first image if available
  const firstSeriesKey = Object.keys(allSeries)[0];
  if (firstSeriesKey && allSeries[firstSeriesKey].images.length > 0) {
    // Set the current series
    currentSeriesId = firstSeriesKey;
    currentImageIndex = 0;

    // Load the first image
    selectSeries(firstSeriesKey, 0);
  } else {
    console.error("No series or images found to display");
  }

  showLoading(false);

  // Update status
  updateStatus(
    `Loaded ${Object.keys(allSeries).length} series with ${validFiles} images`
  );
}

// FIXED: Create series UI - This function was missing proper implementation
function createSeriesUI() {
  if (!seriesContainer) {
    console.error("seriesContainer not found");
    return;
  }

  // Clear existing content
  seriesContainer.innerHTML = "";

  // Check if we have any series
  if (!allSeries || Object.keys(allSeries).length === 0) {
    seriesContainer.innerHTML = `
      <div class="alert alert-warning">
        <i class="fas fa-exclamation-triangle"></i>
        No series found to display
      </div>
    `;
    return;
  }

  // Create series items
  Object.entries(allSeries).forEach(([seriesKey, series]) => {
    const seriesItem = document.createElement("div");
    seriesItem.className = "series-item";
    seriesItem.id = `series_${seriesKey}`;

    const seriesHeader = document.createElement("div");
    seriesHeader.className = "series-header";
    seriesHeader.style.cursor = "pointer";
    seriesHeader.onclick = () => toggleSeries(seriesKey);

    seriesHeader.innerHTML = `
      <div>
        <div class="series-title" style="font-weight: bold; margin-bottom: 4px;">
          ${series.seriesDescription || "Unnamed Series"}
        </div>
        <div class="series-info" style="font-size: 0.85em; color: #666;">
          ${series.modality || "UN"} • ${
      series.patientName || "Unknown Patient"
    }
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <div class="series-count" style="background: #007bff; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em;">
          ${series.images ? series.images.length : 0}
        </div>
        <i class="fas fa-chevron-down expand-icon" style="transition: transform 0.2s;"></i>
      </div>
    `;

    const thumbnailsGrid = document.createElement("div");
    thumbnailsGrid.className = "thumbnails-grid";
    thumbnailsGrid.id = `thumbnails_${seriesKey}`;
    thumbnailsGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
      gap: 8px;
      margin-top: 10px;
      padding: 10px;
      background: #f8f9fa;
      border-radius: 4px;
    `;

    // Create thumbnails
    if (series.images && series.images.length > 0) {
      series.images.forEach((image, index) => {
        const thumbnail = document.createElement("div");
        thumbnail.className = "thumbnail";
        thumbnail.style.cssText = `
          width: 80px;
          height: 80px;
          border: 2px solid #ddd;
          border-radius: 4px;
          cursor: pointer;
          position: relative;
          background: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        `;

        thumbnail.onclick = (e) => {
          e.stopPropagation();
          selectSeries(seriesKey, index);
        };

        thumbnail.onmouseenter = () => {
          thumbnail.style.borderColor = "#007bff";
          thumbnail.style.transform = "scale(1.05)";
        };

        thumbnail.onmouseleave = () => {
          if (!thumbnail.classList.contains("selected")) {
            thumbnail.style.borderColor = "#ddd";
          }
          thumbnail.style.transform = "scale(1)";
        };

        const loadingDiv = document.createElement("div");
        loadingDiv.className = "thumbnail-loading";
        loadingDiv.innerHTML =
          '<i class="fas fa-spinner fa-spin" style="color: #007bff;"></i>';
        thumbnail.appendChild(loadingDiv);

        const info = document.createElement("div");
        info.className = "thumbnail-info";
        info.style.cssText = `
          position: absolute;
          bottom: 2px;
          right: 2px;
          background: rgba(0,0,0,0.7);
          color: white;
          padding: 2px 6px;
          border-radius: 2px;
          font-size: 0.7em;
        `;
        info.textContent = `${index + 1}`;
        thumbnail.appendChild(info);

        thumbnailsGrid.appendChild(thumbnail);

        // Load thumbnail with delay to prevent overwhelming
        setTimeout(() => {
          loadThumbnailImage(image.imageId, thumbnail, loadingDiv, index);
        }, index * 50);
      });
    } else {
      thumbnailsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; color: #666; padding: 20px;">
          No images found in this series
        </div>
      `;
    }

    seriesItem.appendChild(seriesHeader);
    seriesItem.appendChild(thumbnailsGrid);
    seriesContainer.appendChild(seriesItem);
  });
}

// Load thumbnail image
function loadThumbnailImage(imageId, thumbnailContainer, loadingDiv, index) {
  const canvas = document.createElement("canvas");
  canvas.className = "thumbnail-image";
  canvas.width = 76;
  canvas.height = 76;
  canvas.style.display = "none";

  cornerstone
    .loadImage(imageId)
    .then((image) => {
      const tempDiv = document.createElement("div");
      tempDiv.style.width = "76px";
      tempDiv.style.height = "76px";
      tempDiv.style.position = "absolute";
      tempDiv.style.left = "-9999px";
      document.body.appendChild(tempDiv);

      cornerstone.enable(tempDiv);

      const viewport = cornerstone.getDefaultViewportForImage(tempDiv, image);
      viewport.scale = 1.0;

      cornerstone.displayImage(tempDiv, image, viewport);

      setTimeout(() => {
        const cornerstoneCanvas = tempDiv.querySelector("canvas");

        if (cornerstoneCanvas) {
          const ctx = canvas.getContext("2d");
          ctx.drawImage(cornerstoneCanvas, 0, 0, 76, 76);
        } else {
          console.warn("No canvas found in tempDiv");
        }

        cornerstone.disable(tempDiv);
        document.body.removeChild(tempDiv);

        if (loadingDiv && loadingDiv.parentNode) {
          loadingDiv.remove();
        }
        canvas.style.display = "block";

        const infoElement = thumbnailContainer.querySelector(".thumbnail-info");
        thumbnailContainer.insertBefore(canvas, infoElement || null);
      }, 50);
    })
    .catch((error) => {
      if (loadingDiv) {
        loadingDiv.innerHTML =
          '<i class="fas fa-exclamation-triangle" style="color: #dc3545;"></i>';
      }
    });
}

// Toggle series expansion function
function toggleSeries(seriesKey) {
  console.log("Toggling series:", seriesKey);

  const seriesItem = document.getElementById(`series_${seriesKey}`);

  if (!seriesItem) {
    console.error(`Series item with ID 'series_${seriesKey}' not found`);
    return;
  }

  // Toggle the collapsed state
  seriesItem.classList.toggle("series-collapsed");

  // Rotate the chevron icon
  const expandIcon = seriesItem.querySelector(".expand-icon");
  if (expandIcon) {
    const isCollapsed = seriesItem.classList.contains("series-collapsed");
    expandIcon.style.transform = isCollapsed
      ? "rotate(-90deg)"
      : "rotate(0deg)";
    expandIcon.style.transition = "transform 0.3s ease";
  } else {
    console.warn("Expand icon not found in series item");
  }
}

// FIXED: Select series and image - This was the main issue!
function selectSeries(seriesKey, imageIndex = 0) {
  const series = allSeries[seriesKey];
  if (!series || !series.images[imageIndex]) {
    console.error("Series or image not found", {
      seriesKey,
      imageIndex,
      series,
    });
    return;
  }

  currentSeriesId = seriesKey;
  currentImageIndex = imageIndex;

  // Get the active element
  const el = getActiveElement();
  if (!el) {
    console.error("No active viewport found.");
    return;
  }

  // Ensure cornerstone is enabled on the element
  ensureEnabled(el);

  const imageId = series.images[imageIndex].imageId;

  // Load and display the image
  cornerstone
    .loadImage(imageId)
    .then((image) => {
      // Display the image
      cornerstone.displayImage(el, image);

      // Setup tools and UI
      setupToolsForViewport(el);
      updateImageInfo();
      updateCineControls();
      showViewer();

      // Update thumbnail selection
      updateThumbnailSelection(seriesKey, imageIndex);
    })
    .catch((err) => {
      console.error("Error loading/displaying image:", err);
      showError("Failed to display image: " + err.message);
    });
}

// Update thumbnail selection UI
function updateThumbnailSelection(seriesKey, imageIndex) {
  // Remove previous selection
  document.querySelectorAll(".thumbnail.selected").forEach((thumb) => {
    thumb.classList.remove("selected");
    thumb.style.borderColor = "#ddd";
  });

  // Add selection to current thumbnail
  const thumbnailsGrid = document.getElementById(`thumbnails_${seriesKey}`);
  if (thumbnailsGrid) {
    const thumbnails = thumbnailsGrid.querySelectorAll(".thumbnail");
    if (thumbnails[imageIndex]) {
      thumbnails[imageIndex].classList.add("selected");
      thumbnails[imageIndex].style.borderColor = "#007bff";
      thumbnails[imageIndex].style.borderWidth = "3px";
    }
  }
}

// Show viewer (hide empty state)
function showViewer() {
  if (emptyState) emptyState.style.display = "none";
  if (dicomImage) dicomImage.style.display = "block";
}

// Update image information display
function updateImageInfo() {
  if (!currentSeriesId || !allSeries[currentSeriesId]) return;

  const series = allSeries[currentSeriesId];
  const currentImage = series.images[currentImageIndex];

  const topLeft = document.getElementById("topLeft");
  const topRight = document.getElementById("topRight");
  const bottomLeft = document.getElementById("bottomLeft");
  const bottomRight = document.getElementById("bottomRight");

  if (topLeft) {
    topLeft.innerHTML = `Patient: ${series.patientName}<br>Study: ${series.studyDescription}`;
  }

  if (topRight) {
    topRight.innerHTML = `Date: ${series.studyDate}<br>Time: ${series.studyTime}`;
  }

  if (bottomLeft) {
    bottomLeft.innerHTML = `Series: ${series.seriesDescription}<br>Image: ${
      currentImageIndex + 1
    }/${series.images.length}`;
  }

  // Get viewport info from the active element
  const activeElement = getActiveElement();
  if (
    activeElement &&
    cornerstone.getEnabledElements().some((e) => e.element === activeElement)
  ) {
    try {
      const viewport = cornerstone.getViewport(activeElement);
      if (bottomRight) {
        bottomRight.innerHTML = `WW/WC: ${Math.round(
          viewport.voi.windowWidth
        )}/${Math.round(
          viewport.voi.windowCenter
        )}<br>Zoom: ${viewport.scale.toFixed(1)}x`;
      }
    } catch (error) {
      console.warn("Could not get viewport info:", error);
    }
  }
}

// Update cine controls
function updateCineControls() {
  const series = allSeries[currentSeriesId];
  if (!series || !cineControls) {
    if (cineControls) cineControls.style.display = "none";
    return;
  }

  cineControls.style.display = "block";

  // Update progress
  const progress =
    series.images.length > 1
      ? (currentImageIndex / (series.images.length - 1)) * 100
      : 0;
  if (progressFill) progressFill.style.width = progress + "%";
  if (progressThumb) progressThumb.style.left = progress + "%";

  // Update time displays
  if (currentTimeDisplay)
    currentTimeDisplay.textContent = `${currentImageIndex + 1} / ${
      series.images.length
    }`;
  if (totalTimeDisplay)
    totalTimeDisplay.textContent = series.images.length.toString();

  // Update button states
  if (firstBtn) firstBtn.disabled = currentImageIndex === 0;
  if (prevBtn) prevBtn.disabled = currentImageIndex === 0 && !isLooping;
  if (nextBtn)
    nextBtn.disabled =
      currentImageIndex === series.images.length - 1 && !isLooping;
  if (lastBtn)
    lastBtn.disabled = currentImageIndex === series.images.length - 1;

  // Show/hide controls based on series length
  const shouldShow = series.images.length > 1;
  cineControls.style.display = shouldShow ? "block" : "none";
}

// Cine playback functions
function togglePlayback() {
  if (!currentSeriesId || !allSeries[currentSeriesId]) return;

  if (isPlaying) {
    stopPlayback();
  } else {
    startPlayback();
  }
}

function startPlayback() {
  const series = allSeries[currentSeriesId];
  if (!series || series.images.length <= 1) return;

  isPlaying = true;
  if (playPauseBtn) playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';

  const frameRate = 1000 / (10 * playbackSpeed); // Base 10 FPS

  if (playbackInterval) {
    clearInterval(playbackInterval);
  }

  playbackInterval = setInterval(() => {
    const series = allSeries[currentSeriesId];
    if (!series) {
      stopPlayback();
      return;
    }

    let nextIndex = currentImageIndex + playDirection;

    if (nextIndex >= series.images.length) {
      if (isLooping) {
        nextIndex = 0;
      } else {
        stopPlayback();
        return;
      }
    } else if (nextIndex < 0) {
      if (isLooping) {
        nextIndex = series.images.length - 1;
      } else {
        stopPlayback();
        return;
      }
    }

    selectSeries(currentSeriesId, nextIndex);
  }, frameRate);
}

function stopPlayback() {
  isPlaying = false;
  if (playPauseBtn) playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';

  if (playbackInterval) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }
}

function setPlaybackSpeed(speed) {
  playbackSpeed = speed;

  // Update active speed button
  document.querySelectorAll(".speed-btn").forEach((btn) => {
    btn.classList.remove("active");
    if (parseFloat(btn.dataset.speed) === speed) {
      btn.classList.add("active");
    }
  });

  // Restart playback with new speed if currently playing
  if (isPlaying) {
    stopPlayback();
    setTimeout(() => startPlayback(), 100);
  }
}

function toggleLoop() {
  isLooping = !isLooping;
  if (loopBtn) {
    loopBtn.style.opacity = isLooping ? "1" : "0.5";
    loopBtn.style.background = isLooping
      ? "rgba(16, 185, 129, 0.9)"
      : "rgba(59, 130, 246, 0.9)";
  }
}

function goToImage(index) {
  const series = allSeries[currentSeriesId];
  if (!series) return;

  const clampedIndex = Math.max(0, Math.min(series.images.length - 1, index));
  selectSeries(currentSeriesId, clampedIndex);
}

function changeImage(direction) {
  const series = allSeries[currentSeriesId];
  if (!series) return;

  let newIndex = currentImageIndex + direction;

  if (newIndex >= series.images.length) {
    newIndex = isLooping ? 0 : series.images.length - 1;
  } else if (newIndex < 0) {
    newIndex = isLooping ? series.images.length - 1 : 0;
  }

  if (newIndex !== currentImageIndex) {
    selectSeries(currentSeriesId, newIndex);
  }
}

// Progress bar event handlers
function handleProgressClick(e) {
  const rect = progressBar.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const percentage = Math.max(0, Math.min(1, clickX / rect.width));

  const series = allSeries[currentSeriesId];
  if (series) {
    const targetIndex = Math.round(percentage * (series.images.length - 1));
    goToImage(targetIndex);
  }
}

// Tool activation and management
function setupToolsForViewport(element) {
  const series = allSeries[currentSeriesId];
  if (!series || series.images.length <= 1) return;

  if (typeof cornerstoneTools === "undefined") return;

  const StackScrollMouseWheelTool = cornerstoneTools.StackScrollMouseWheelTool;

  const stack = {
    currentImageIdIndex: currentImageIndex,
    imageIds: series.images.map((img) => img.imageId),
  };

  cornerstoneTools.addStackStateManager(element, ["stack"]);
  cornerstoneTools.addToolState(element, "stack", stack);
  cornerstoneTools.addTool(StackScrollMouseWheelTool);
  cornerstoneTools.setToolActive("StackScrollMouseWheel", {});

  let scrollAccumulator = 0;
  const SCROLL_THRESHOLD = 100;

  // Remove existing wheel listeners
  element.removeEventListener("wheel", element._wheelHandler);

  element._wheelHandler = function (event) {
    event.preventDefault();

    scrollAccumulator += event.deltaY;

    if (scrollAccumulator >= SCROLL_THRESHOLD) {
      changeImage(1);
      scrollAccumulator = 0;
    } else if (scrollAccumulator <= -SCROLL_THRESHOLD) {
      changeImage(-1);
      scrollAccumulator = 0;
    }
  };

  element.addEventListener("wheel", element._wheelHandler);
  activateTool("wwwc");
}

// Tool activation
function activateTool(toolName) {
  const activeElement = getActiveElement();
  if (
    !activeElement ||
    !cornerstone.getEnabledElements().some((e) => e.element === activeElement)
  ) {
    return;
  }

  if (!cornerstone.getEnabledElement(activeElement)) return;

  document
    .querySelectorAll(".tool-btn")
    .forEach((btn) => btn.classList.remove("active"));

  if (typeof cornerstoneTools === "undefined") return;

  cornerstoneTools.setToolPassive("Wwwc");
  cornerstoneTools.setToolPassive("Zoom");
  cornerstoneTools.setToolPassive("Pan");
  cornerstoneTools.setToolPassive("Magnify");

  switch (toolName) {
    case "wwwc":
      const WwwcTool = cornerstoneTools.WwwcTool;
      cornerstoneTools.addTool(WwwcTool);
      cornerstoneTools.setToolActive("Wwwc", { mouseButtonMask: 1 });
      const wwwcTool = document.getElementById("wwwcTool");
      if (wwwcTool) wwwcTool.classList.add("active");
      break;

    case "zoom":
      const ZoomTool = cornerstoneTools.ZoomTool;
      cornerstoneTools.addTool(ZoomTool, {
        configuration: {
          invert: false,
          preventZoomOutsideImage: false,
          minScale: 0.1,
          maxScale: 20.0,
        },
      });
      cornerstoneTools.setToolActive("Zoom", { mouseButtonMask: 1 });
      break;

    case "pan":
      const PanTool = cornerstoneTools.PanTool;
      cornerstoneTools.addTool(PanTool);
      cornerstoneTools.setToolActive("Pan", { mouseButtonMask: 1 });
      break;

    case "magnify":
      const MagnifyTool = cornerstoneTools.MagnifyTool;
      cornerstoneTools.addTool(MagnifyTool);
      cornerstoneTools.setToolActive("Magnify", { mouseButtonMask: 1 });
      break;

    case "bidirectional":
      const BidirectionalTool = cornerstoneTools.BidirectionalTool;
      cornerstoneTools.addTool(BidirectionalTool);
      cornerstoneTools.setToolActive("Bidirectional", { mouseButtonMask: 1 });
      break;

    case "ellipse":
      const EllipticalRoiTool = cornerstoneTools.EllipticalRoiTool;
      cornerstoneTools.addTool(EllipticalRoiTool);
      cornerstoneTools.setToolActive("EllipticalRoi", { mouseButtonMask: 1 });
      break;

    case "rectangle":
      const RectangleRoiTool = cornerstoneTools.RectangleRoiTool;
      cornerstoneTools.addTool(RectangleRoiTool);
      cornerstoneTools.setToolActive("RectangleRoi", { mouseButtonMask: 1 });
      break;

    case "freehand":
      const FreehandRoiTool = cornerstoneTools.FreehandRoiTool;
      cornerstoneTools.addTool(FreehandRoiTool);
      cornerstoneTools.setToolActive("FreehandRoi", { mouseButtonMask: 1 });
      break;

    case "length":
      const LengthTool = cornerstoneTools.LengthTool;
      cornerstoneTools.addTool(LengthTool);
      cornerstoneTools.setToolActive("Length", { mouseButtonMask: 1 });
      break;

    case "angle":
      const AngleTool = cornerstoneTools.AngleTool;
      cornerstoneTools.addTool(AngleTool);
      cornerstoneTools.setToolActive("Angle", { mouseButtonMask: 1 });
      break;

    case "probe":
      const ProbeTool = cornerstoneTools.ProbeTool;
      cornerstoneTools.addTool(ProbeTool);
      cornerstoneTools.setToolActive("Probe", { mouseButtonMask: 1 });
      break;

    case "arrow":
      const ArrowAnnotateTool = cornerstoneTools.ArrowAnnotateTool;
      cornerstoneTools.addTool(ArrowAnnotateTool);
      cornerstoneTools.setToolActive("ArrowAnnotate", { mouseButtonMask: 1 });
      break;

    case "eraser":
      const EraserTool = cornerstoneTools.EraserTool;
      cornerstoneTools.addTool(EraserTool);
      cornerstoneTools.setToolActive("Eraser", { mouseButtonMask: 1 });
      break;
  }

  closeAllDropdowns();
}

// Window/Level presets
function applyPreset(presetName) {
  const activeElement = getActiveElement();
  if (
    !activeElement ||
    !cornerstone.getEnabledElements().some((e) => e.element === activeElement)
  ) {
    return;
  }

  if (!cornerstone.getEnabledElement(activeElement)) return;

  const viewport = cornerstone.getViewport(activeElement);

  switch (presetName) {
    case "soft":
      viewport.voi.windowWidth = 400;
      viewport.voi.windowCenter = 20;
      break;
    case "bone":
      viewport.voi.windowWidth = 2000;
      viewport.voi.windowCenter = 300;
      break;
    case "lung":
      viewport.voi.windowWidth = 1500;
      viewport.voi.windowCenter = -600;
      break;
    case "brain":
      viewport.voi.windowWidth = 80;
      viewport.voi.windowCenter = 40;
      break;
  }

  cornerstone.setViewport(activeElement, viewport);
  updateImageInfo();
}

function invertImage() {
  const activeElement = getActiveElement();
  if (
    !activeElement ||
    !cornerstone.getEnabledElements().some((e) => e.element === activeElement)
  ) {
    return;
  }

  if (!cornerstone.getEnabledElement(activeElement)) return;

  const viewport = cornerstone.getViewport(activeElement);
  viewport.invert = !viewport.invert;
  cornerstone.setViewport(activeElement, viewport);
}

function resetViewport() {
  const activeElement = getActiveElement();
  if (
    !activeElement ||
    !cornerstone.getEnabledElements().some((e) => e.element === activeElement)
  ) {
    return;
  }

  if (!cornerstone.getEnabledElement(activeElement)) return;

  cornerstone.reset(activeElement);
  updateImageInfo();
}

// Layout management
function changeLayout(layout) {
  currentLayout = layout;

  const container = document.getElementById("viewportContainer");
  const [rows, cols] = layout.split("x").map(Number);

  // Reset grid state
  gridViewports = [];
  activeGridViewport = 0;

  // 1x1 uses the single #dicomImage; others use the container grid
  if (rows === 1 && cols === 1) {
    // Hide grid container and clean its cells
    if (container) {
      // Either hide with display or visibility; display:none is fine here since we will
      // render into dicomImage and then call resize on dicomImage.
      container.style.display = "none"; // optional: container.style.visibility = "hidden";
      container.innerHTML = "";
    }

    // Show the single dicomImage without collapsing layout
    if (dicomImage) {
      dicomImage.style.display = "block"; // ensure participates in layout
      dicomImage.style.visibility = "visible"; // or dicomImage.style.opacity = "1";
    }

    ensureEnabled(dicomImage);
    activeViewport = dicomImage;

    // Repaint current image if we have one
    const series = allSeries[currentSeriesId];
    if (series && series.images[currentImageIndex]) {
      const imageId = series.images[currentImageIndex].imageId;
      displayImageInto(dicomImage, imageId);

      // IMPORTANT: After making the element visible, force cornerstone to recompute size
      if (window.cornerstone && dicomImage) {
        window.cornerstone.resize(dicomImage, true);
      }

      setupToolsForViewport(dicomImage);
    }
    return;
  }

  // Grid layout branch
  // Keep dicomImage in layout but invisible so its size doesn't collapse unexpectedly
  if (dicomImage) {
    dicomImage.style.visibility = "hidden"; // or dicomImage.style.opacity = "0";
    dicomImage.style.display = "block"; // keep block so dimensions remain predictable
  }

  if (!container) {
    console.error("#viewportContainer not found in DOM.");
    return;
  }

  container.style.display = "grid";
  container.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  container.innerHTML = "";

  // Build grid viewports
  for (let i = 0; i < rows * cols; i++) {
    const vp = document.createElement("div");
    vp.className = "dicom-viewport";
    vp.style.width = "100%";
    vp.style.height = "100%";
    vp.style.border = "1px solid #333";

    container.appendChild(vp);
    ensureEnabled(vp);
    gridViewports.push(vp);

    vp.addEventListener("click", () => {
      activeGridViewport = i;
      activeViewport = vp;
    });
  }

  // Set first grid cell active
  activeGridViewport = 0;
  activeViewport = gridViewports;

  // Repaint current image into first cell (if any)
  const series = allSeries[currentSeriesId];
  if (series && series.images[currentImageIndex]) {
    const imageId = series.images[currentImageIndex].imageId;
    displayImageInto(activeViewport, imageId);

    // After creating/showing grid, make sure each viewport has real dimensions from CSS.
    // If needed, you may call resize on each enabled viewport after it is attached and visible.
    if (window.cornerstone && activeViewport) {
      window.cornerstone.resize(activeViewport, true);
    }

    setupToolsForViewport(activeViewport);
  }
}

// Utility functions
function getActiveElement() {
  if (currentLayout === "1x1") return dicomImage;
  return gridViewports[activeGridViewport] || null;
}

function ensureEnabled(el) {
  if (!el) return false;
  const isEnabled = cornerstone
    .getEnabledElements()
    .some((e) => e.element === el);
  if (!isEnabled) cornerstone.enable(el);
  return true;
}

async function displayImageInto(el, imageId) {
  if (!el) {
    console.error("Viewport element not found.");
    return;
  }
  ensureEnabled(el);
  const image = await cornerstone.loadImage(imageId);
  cornerstone.displayImage(el, image);
}

function getMetadataValue(dataSet, tag) {
  try {
    const element = dataSet.elements[tag];
    if (element) {
      return dataSet.string(tag);
    }
    return null;
  } catch (error) {
    return null;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  if (dateStr.length === 8) {
    return `${dateStr.substring(0, 4)}-${dateStr.substring(
      4,
      6
    )}-${dateStr.substring(6, 8)}`;
  }
  return dateStr;
}

function formatTime(timeStr) {
  if (!timeStr || timeStr.length < 6) return "Unknown";
  const hour = timeStr.substring(0, 2);
  const minute = timeStr.substring(2, 4);
  const second = timeStr.substring(4, 6);
  return `${hour}:${minute}:${second}`;
}

// UI utility functions
function updateStatus(message) {
  if (statusText) statusText.textContent = message;
}

function showLoading(show, message = "Loading...") {
  const loadingOverlay = document.getElementById("loadingOverlay");
  const loadingText = document.getElementById("loadingText");

  if (loadingOverlay) {
    loadingOverlay.style.display = show ? "flex" : "none";
  }

  if (loadingText && message) {
    loadingText.textContent = message;
  }
}

function updateProgress(percent) {
  const progressFill = document.getElementById("progressFill");
  const uploadProgress = document.getElementById("uploadProgress");

  if (progressFill && uploadProgress) {
    if (percent > 0) {
      uploadProgress.style.display = "block";
      progressFill.style.width = percent + "%";
    } else {
      uploadProgress.style.display = "none";
    }
  }
}

function showError(message) {
  const errorDiv = document.getElementById("errorMessage");
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
    setTimeout(() => {
      errorDiv.style.display = "none";
    }, 5000);
  }
  console.error("Error:", message);
  alert("Error: " + message); // Fallback alert for debugging
}

function showSuccess(message) {
  const successDiv = document.getElementById("successMessage");
  if (successDiv) {
    successDiv.textContent = message;
    successDiv.style.display = "block";
    setTimeout(() => {
      successDiv.style.display = "none";
    }, 3000);
  }
  console.log("Success:", message);
}

// Dropdown utility functions
function toggleDropdown(dropdownId) {
  closeAllDropdowns();
  const dropdown = document.getElementById(dropdownId);
  if (dropdown) dropdown.classList.add("show");
}

function closeAllDropdowns() {
  document.querySelectorAll(".tool-dropdown").forEach((dropdown) => {
    dropdown.classList.remove("show");
  });
}

// DICOM Tags functionality
async function showDicomTags() {
  try {
    // Check if jQuery is loaded
    if (typeof $ === "undefined") {
      alert("jQuery not loaded properly. Please refresh the page.");
      return;
    }

    // Check if any image is loaded
    const enabledElements = cornerstone.getEnabledElements();
    if (!enabledElements || enabledElements.length === 0) {
      alert("No enabled elements found!");
      return;
    }

    const enabledElement = enabledElements[0];
    if (!enabledElement || !enabledElement.image) {
      alert("No image loaded!");
      return;
    }

    const image = enabledElement.image;
    const imageId = image.imageId;

    console.log("Image ID:", imageId);

    let dataSet = null;

    // Try to get from cache
    try {
      if (
        cornerstoneWADOImageLoader &&
        cornerstoneWADOImageLoader.wadouri &&
        cornerstoneWADOImageLoader.wadouri.dataSetCacheManager
      ) {
        dataSet =
          cornerstoneWADOImageLoader.wadouri.dataSetCacheManager.get(imageId);
      }
    } catch (e) {
      console.log("Cache access failed:", e);
    }

    // Try to get from image.data
    if (!dataSet && image.data && image.data.byteArray) {
      try {
        const arrayBuffer = image.data.byteArray.buffer || image.data.byteArray;
        dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));
      } catch (e) {
        console.log("Parsing from byteArray failed:", e);
      }
    }

    // Try to re-load and parse the image
    if (!dataSet) {
      try {
        const reloadedImage = await cornerstone.loadAndCacheImage(imageId);
        if (reloadedImage.data && reloadedImage.data.byteArray) {
          const arrayBuffer =
            reloadedImage.data.byteArray.buffer || reloadedImage.data.byteArray;
          dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));
        }
      } catch (e) {
        console.log("Reload and parse failed:", e);
      }
    }

    if (!dataSet || !dataSet.elements) {
      // Show a basic info modal instead
      let html = "<div class='alert alert-warning'>";
      html += "<h6>DICOM Dataset Not Available</h6>";
      html += "<p>Unable to parse DICOM tags from this image.</p>";
      html += "<p><strong>Image Info:</strong></p>";
      html += `<p>Image ID: ${imageId}</p>`;
      html += `<p>Width: ${image.width || "Unknown"}</p>`;
      html += `<p>Height: ${image.height || "Unknown"}</p>`;
      html += `<p>Pixel Spacing: ${
        image.pixelSpacing ? image.pixelSpacing.join(", ") : "Unknown"
      }</p>`;
      html += "</div>";

      const dicomTagContent = document.getElementById("dicomTagContent");
      if (dicomTagContent) dicomTagContent.innerHTML = html;

      // Show modal
      try {
        $("#dicomTagModal").modal("show");
      } catch (modalError) {
        const modal = document.getElementById("dicomTagModal");
        if (modal) {
          modal.style.display = "block";
          modal.classList.add("show");
        }
      }
      return;
    }

    // Create the tags table
    let html = createDicomTagsTable(dataSet, image);

    const dicomTagContent = document.getElementById("dicomTagContent");
    if (dicomTagContent) dicomTagContent.innerHTML = html;

    // Show modal
    try {
      $("#dicomTagModal").modal("show");
    } catch (modalError) {
      const modal = document.getElementById("dicomTagModal");
      if (modal) {
        modal.style.display = "block";
        modal.classList.add("show");
        // Add backdrop
        const backdrop = document.createElement("div");
        backdrop.className = "modal-backdrop fade show";
        backdrop.id = "modalBackdrop";
        document.body.appendChild(backdrop);

        // Close button functionality
        const closeBtn = modal.querySelector('[data-dismiss="modal"]');
        if (closeBtn) {
          closeBtn.onclick = function () {
            modal.style.display = "none";
            modal.classList.remove("show");
            const backdrop = document.getElementById("modalBackdrop");
            if (backdrop) backdrop.remove();
          };
        }
      }
    }
  } catch (err) {
    console.error("DICOM tag error:", err);
    showError("Error loading DICOM tags: " + err.message);
  }
}

function createDicomTagsTable(dataSet, image) {
  let html = "<div class='table-responsive'>";
  html += "<table class='table table-bordered table-sm table-striped'>";
  html += "<thead class='thead-dark'>";
  html +=
    "<tr><th style='width: 15%'>Tag</th><th style='width: 35%'>Name</th><th style='width: 50%'>Value</th></tr>";
  html += "</thead><tbody>";

  // Common DICOM tags to prioritize
  const commonTags = [
    "x00100010", // Patient Name
    "x00100020", // Patient ID
    "x00100030", // Patient Birth Date
    "x00100040", // Patient Sex
    "x00080020", // Study Date
    "x00080030", // Study Time
    "x00080060", // Modality
    "x00200013", // Instance Number
    "x00080008", // Image Type
    "x00280010", // Rows
    "x00280011", // Columns
    "x00280100", // Bits Allocated
    "x00280101", // Bits Stored
    "x00280102", // High Bit
    "x00281050", // Window Center
    "x00281051", // Window Width
  ];

  function getTagValue(dataSet, tag) {
    try {
      const el = dataSet.elements[tag];
      if (!el) return "[Not Present]";

      const vr = el.vr || "";

      const readAsString = () => {
        let s = dataSet.string(tag);
        if (s == null || s === "") return "[Empty]";
        s = s.replace(/\^/g, " ").trim();
        if (s.length > 200) s = s.slice(0, 200) + "…";
        return s;
      };

      switch (vr) {
        case "PN":
        case "LO":
        case "SH":
        case "ST":
        case "LT":
        case "UT":
        case "CS":
        case "DA":
        case "TM":
        case "UI":
        case "AS":
          return readAsString();
        case "IS":
          return dataSet.intString(tag);
        case "DS":
          return dataSet.floatString(tag);
        case "US":
          return dataSet.uint16(tag);
        case "SS":
          return dataSet.int16(tag);
        case "UL":
          return dataSet.uint32(tag);
        case "SL":
          return dataSet.int32(tag);
        case "FL":
          return dataSet.float(tag);
        case "FD":
          return dataSet.double(tag);
        case "SQ":
          return "[Sequence]";
        default:
          const asStr = readAsString();
          if (asStr !== "[Empty]") return asStr;
          const len = el.length;
          if (len === 2) return dataSet.uint16(tag);
          if (len === 4) return dataSet.uint32(tag);
          if (len === 8) {
            const f = dataSet.double(tag);
            if (typeof f === "number" && !Number.isNaN(f)) return f;
          }
          return "[Binary/Complex Data]";
      }
    } catch {
      return "[Error Reading]";
    }
  }

  function getTagDescription(tag) {
    const tagDescriptions = {
      x00100010: "Patient Name",
      x00100020: "Patient ID",
      x00100030: "Patient Birth Date",
      x00100040: "Patient Sex",
      x00080020: "Study Date",
      x00080030: "Study Time",
      x00080060: "Modality",
      x00200013: "Instance Number",
      x00080008: "Image Type",
      x00280010: "Rows",
      x00280011: "Columns",
      x00280100: "Bits Allocated",
      x00280101: "Bits Stored",
      x00280102: "High Bit",
      x00281050: "Window Center",
      x00281051: "Window Width",
    };

    if (tagDescriptions[tag]) return tagDescriptions[tag];

    const formattedTag = `(${tag.substring(1, 5)},${tag.substring(5)})`;

    if (dicomParser && dicomParser.dictionary) {
      const entry = dicomParser.dictionary[formattedTag];
      if (entry) {
        if (entry.name) return entry.name;
        if (typeof entry === "string") return entry;
      }
    }

    return formattedTag;
  }

  // Add summary info at the top
  const summaryInfo = `
    <div class='alert alert-info mb-3'>
      <h6><i class='fas fa-info-circle'></i> DICOM Information</h6>
      <div class='row'>
        <div class='col-md-6'>
          <strong>Total Tags:</strong> ${
            Object.keys(dataSet.elements).length
          }<br>
          <strong>Image Size:</strong> ${image.width}×${image.height}
        </div>
        <div class='col-md-6'>
          <strong>Patient:</strong> ${getTagValue(dataSet, "x00100010")}<br>
          <strong>Modality:</strong> ${getTagValue(dataSet, "x00080060")}
        </div>
      </div>
    </div>
  `;

  // First add common tags
  let addedTags = new Set();
  commonTags.forEach((tag) => {
    if (dataSet.elements[tag]) {
      const name = getTagDescription(tag);
      const value = getTagValue(dataSet, tag);
      html += `<tr><td><code>${tag}</code></td><td><strong>${name}</strong></td><td>${value}</td></tr>`;
      addedTags.add(tag);
    }
  });

  // Add separator if we have common tags
  if (addedTags.size > 0) {
    html +=
      "<tr><td colspan='3' class='table-secondary text-center'><strong>Other Tags</strong></td></tr>";
  }

  // Then add remaining tags
  const remainingTags = Object.keys(dataSet.elements).filter(
    (tag) => !addedTags.has(tag)
  );
  remainingTags.slice(0, 50).forEach((tag) => {
    const name = getTagDescription(tag);
    const value = getTagValue(dataSet, tag);
    html += `<tr><td><code>${tag}</code></td><td>${name}</td><td>${value}</td></tr>`;
  });

  html += "</tbody></table></div>";

  return summaryInfo + html;
}

// Export DICOM Tags to CSV
function exportDicomTags() {
  try {
    const enabledElements = cornerstone.getEnabledElements();
    if (!enabledElements || enabledElements.length === 0) {
      alert("No image loaded!");
      return;
    }

    const enabledElement = enabledElements[0];
    const image = enabledElement.image;
    const imageId = image.imageId;

    // Get dataset (same logic as showDicomTags)
    let dataSet = null;

    try {
      if (
        cornerstoneWADOImageLoader &&
        cornerstoneWADOImageLoader.wadouri &&
        cornerstoneWADOImageLoader.wadouri.dataSetCacheManager
      ) {
        dataSet =
          cornerstoneWADOImageLoader.wadouri.dataSetCacheManager.get(imageId);
      }
    } catch (e) {
      console.log("Cache access failed:", e);
    }

    if (!dataSet && image.data && image.data.byteArray) {
      try {
        const arrayBuffer = image.data.byteArray.buffer || image.data.byteArray;
        dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));
      } catch (e) {
        console.log("Parsing failed:", e);
      }
    }

    if (!dataSet || !dataSet.elements) {
      alert("No DICOM data available to export!");
      return;
    }

    // Create CSV content
    let csvContent = "Tag,Name,Value\n";

    Object.keys(dataSet.elements).forEach((tag) => {
      try {
        const name = "Unknown"; // Simplified for export
        let value = "";

        try {
          value = dataSet.string(tag) || "[Empty]";
        } catch (e) {
          try {
            value = dataSet.uint16(tag) || "[Empty]";
          } catch (e2) {
            value = "[Binary/Complex]";
          }
        }

        // Escape commas and quotes in CSV
        value = String(value).replace(/"/g, '""');
        if (
          value.includes(",") ||
          value.includes('"') ||
          value.includes("\n")
        ) {
          value = `"${value}"`;
        }

        csvContent += `${tag},"${name}","${value}"\n`;
      } catch (e) {
        console.log("Error processing tag:", tag, e);
      }
    });

    // Create and download file
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.setAttribute("href", url);
    link.setAttribute("download", `dicom_tags_${Date.now()}.csv`);
    link.style.visibility = "hidden";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showSuccess("DICOM tags exported successfully.");
  } catch (error) {
    console.error("Export error:", error);
    showError("Error exporting DICOM tags: " + error.message);
  }
}

// Keyboard shortcuts
document.addEventListener("keydown", function (e) {
  if (!currentSeriesId) return;

  switch (e.keyCode) {
    case 37: // Left arrow
      e.preventDefault();
      changeImage(-1);
      break;
    case 39: // Right arrow
      e.preventDefault();
      changeImage(1);
      break;
    case 38: // Up arrow
      e.preventDefault();
      changeImage(-1);
      break;
    case 40: // Down arrow
      e.preventDefault();
      changeImage(1);
      break;
    case 32: // Spacebar - Play/Pause
      e.preventDefault();
      togglePlayback();
      break;
    case 82: // R key - Reset
      if (e.ctrlKey) {
        e.preventDefault();
        resetViewport();
      }
      break;
    case 73: // I key - Invert
      if (e.ctrlKey) {
        e.preventDefault();
        invertImage();
      }
      break;
    case 72: // H key - Home (first image)
      e.preventDefault();
      goToImage(0);
      break;
    case 69: // E key - End (last image)
      e.preventDefault();
      const series = allSeries[currentSeriesId];
      if (series) goToImage(series.images.length - 1);
      break;
    case 76: // L key - Toggle loop
      e.preventDefault();
      toggleLoop();
      break;
  }
});

// Viewport event listeners
function setupViewportListeners() {
  const element = dicomImage;
  if (!element) return;

  element.addEventListener("cornerstoneimagerendered", function (e) {
    updateImageInfo();
  });

  element.addEventListener("cornerstonenewimage", function (e) {
    updateImageInfo();
    updateCineControls();
  });
}

// Initialize viewport listeners after a delay
window.addEventListener("load", function () {
  setTimeout(setupViewportListeners, 1000);
});

// Add this debug function at the end of script.js
function debugCornerstone3D() {
  console.log("=== Cornerstone3D Debug Info ===");
  console.log("cornerstoneInitialized:", window.cornerstoneInitialized);
  console.log("window.cs3d:", !!window.cs3d);
  console.log("window.cst3d:", !!window.cst3d);

  if (window.cs3d) {
    console.log("cs3d keys:", Object.keys(window.cs3d).slice(0, 15));
    console.log("cs3d.RenderingEngine:", !!window.cs3d.RenderingEngine);
    console.log("cs3d.Enums:", !!window.cs3d.Enums);
    console.log("cs3d.volumeLoader:", !!window.cs3d.volumeLoader);
  }

  if (window.cst3d) {
    console.log("cst3d keys:", Object.keys(window.cst3d).slice(0, 15));
  }

  const allCornerstone = Object.keys(window).filter(
    (k) =>
      k.toLowerCase().includes("cornerstone") ||
      k.includes("cs") ||
      k.includes("CS")
  );
  console.log("All possible globals:", allCornerstone);
  console.log("==============================");
}

// Call this function in browser console to debug: debugCornerstone3D()
window.debugCornerstone3D = debugCornerstone3D;

// Export global functions
window.activateTool = activateTool;
window.applyPreset = applyPreset;
window.invertImage = invertImage;
window.resetViewport = resetViewport;
window.changeLayout = changeLayout;
window.showDicomTags = showDicomTags;
window.exportDicomTags = exportDicomTags;
window.loadDicomFromIndexedDB = loadDicomFromIndexedDB;
window.loadDicomFromStorage = loadDicomFromStorage;
window.activateMPR3D = activateMPR3D;
window.deactivateMPR3D = deactivateMPR3D;
// window.mpr3DState = mpr3dState;

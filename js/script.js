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
const mprBtn = document.getElementById("mprTool");
if (mprBtn) {
  mprBtn.addEventListener("click", () => activateMPR());
}


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
  console.log('DOM Content Loaded');

  // Enable cornerstone on the main viewport
  if (typeof dicomImage !== 'undefined' && dicomImage) {
    // console.log('Enabling cornerstone on dicomImage');
    cornerstone.enable(dicomImage);
    activeViewport = dicomImage;
  }

  // Setup event listeners
  setupEventListeners();

  // Check if we have DICOM data from folder manager
  const hasDicomData = sessionStorage.getItem("hasDicomData");
  const folderId = sessionStorage.getItem("selectedFolderId");
  const dataSource = sessionStorage.getItem("dataSource");

  // console.log('Initialization data:', { hasDicomData, folderId, dataSource });

  if (hasDicomData === "true" && folderId) {
    if (dataSource === "pacs") {
      loadPacsData(folderId);
    } else {
      loadDicomFromIndexedDB(folderId);
    }
  }
});
// Enhanced MPR functionality for DICOM Viewer
// Fixed version with proper image reconstruction

// MPR state management
let mprState = {
  isActive: false,
  volumeData: null,
  crosshairPosition: { x: 0.5, y: 0.5, z: 0.5 }, // Normalized coordinates (0-1)
  viewports: {
    axial: null,
    sagittal: null,
    coronal: null
  },
  imageData: {
    axial: [],
    sagittal: [],
    coronal: []
  },
  dimensions: null,
  spacing: null,
  currentSlices: {
    axial: 0,
    sagittal: 0,
    coronal: 0
  }
};

// Enhanced MPR activation function
async function activateMPR() {
  const container = document.getElementById("mprContainer");
  const normalViewport = document.getElementById("viewportContainer");
  const dicomImage = document.getElementById("dicomImage");

  if (!currentSeriesId || !allSeries[currentSeriesId]) {
    showError("No series loaded for MPR");
    return;
  }

  const series = allSeries[currentSeriesId];
  if (series.images.length < 5) {
    showError("MPR requires at least 5 images in the series");
    return;
  }

  showLoading(true, "Preparing MPR views...");

  try {
    // Hide normal view
    if (normalViewport) normalViewport.style.display = "none";
    if (dicomImage) dicomImage.style.display = "none";

    // Show MPR container
    container.style.display = "grid";
    mprState.isActive = true;

    // Prepare volume data
    await prepareVolumeData(series);

    // Initialize MPR viewports
    await initializeMPRViewports();

    // Setup synchronization
    setupMPRSynchronization();

    // Initial render
    await renderMPRViews();

    // Setup MPR-specific tools
    setupMPRTools();

    showSuccess("MPR Mode Activated");
    updateStatus("MPR Mode - Use WASD to move crosshair, QE for slices");
  } catch (err) {
    console.error("MPR activation failed:", err);
    showError("MPR activation failed: " + err.message);
    deactivateMPR();
  } finally {
    showLoading(false);
  }
}

// Fixed volume data preparation
async function prepareVolumeData(series) {
  updateStatus("Loading volume data...");
  
  const images = [];
  let loadedCount = 0;
  
  // Load all images with progress tracking
  for (let i = 0; i < series.images.length; i++) {
    try {
      const image = await cornerstone.loadImage(series.images[i].imageId);
      images[i] = image;
      loadedCount++;
      updateStatus(`Loading slice ${loadedCount}/${series.images.length}...`);
      
      // Allow UI to update
      if (i % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    } catch (error) {
      console.error(`Failed to load image ${i}:`, error);
      throw new Error(`Failed to load image ${i + 1}: ${error.message}`);
    }
  }

  // Validate images have consistent dimensions
  const firstImage = images[0];
  const inconsistentImage = images.find(img => 
    img.width !== firstImage.width || img.height !== firstImage.height
  );
  
  if (inconsistentImage) {
    throw new Error("Images have inconsistent dimensions - cannot create MPR");
  }

  mprState.volumeData = images;
  
  // Extract image dimensions and spacing
  mprState.dimensions = {
    width: firstImage.width,
    height: firstImage.height,
    depth: images.length
  };

  // Get pixel spacing from DICOM metadata or use defaults
  mprState.spacing = {
    x: firstImage.columnPixelSpacing || 1,
    y: firstImage.rowPixelSpacing || 1,
    z: firstImage.sliceThickness || firstImage.sliceLocation || 1
  };

  console.log("Volume prepared:", mprState.dimensions, mprState.spacing);
}

// Initialize MPR viewports with proper cleanup
async function initializeMPRViewports() {
  const axialEl = document.getElementById("mprAxial");
  const sagittalEl = document.getElementById("mprSagittal");
  const coronalEl = document.getElementById("mprCoronal");

  if (!axialEl || !sagittalEl || !coronalEl) {
    throw new Error("MPR viewport elements not found");
  }

  // Disable existing cornerstone instances
  [axialEl, sagittalEl, coronalEl].forEach(el => {
    try {
      if (cornerstone.getEnabledElements().some(e => e.element === el)) {
        cornerstone.disable(el);
      }
    } catch (e) {
      // Ignore disable errors
    }
    el.innerHTML = '';
  });

  // Enable cornerstone with delay to ensure proper cleanup
  await new Promise(resolve => setTimeout(resolve, 100));

  try {
    cornerstone.enable(axialEl);
    cornerstone.enable(sagittalEl);  
    cornerstone.enable(coronalEl);
  } catch (error) {
    throw new Error("Failed to enable cornerstone on MPR viewports: " + error.message);
  }

  mprState.viewports = {
    axial: axialEl,
    sagittal: sagittalEl,
    coronal: coronalEl
  };

  // Add viewport labels with better styling
  addViewportLabel(axialEl, "Axial (XY)", "#ff6b6b");
  addViewportLabel(sagittalEl, "Sagittal (YZ)", "#4ecdc4");
  addViewportLabel(coronalEl, "Coronal (XZ)", "#45b7d1");

  // Generate reformatted images for sagittal and coronal views
  await generateReformattedImages();
}

// Fixed image reconstruction with proper pixel data handling
async function generateReformattedImages() {
  const { width, height, depth } = mprState.dimensions;
  
  updateStatus("Generating sagittal reconstructions...");
  
  // Generate sagittal slices (YZ plane) - Fixed algorithm
  mprState.imageData.sagittal = [];
  for (let x = 0; x < width; x++) {
    const sagittalData = new Uint16Array(height * depth);
    
    for (let z = 0; z < depth; z++) {
      const sourceImage = mprState.volumeData[z];
      const sourcePixelData = sourceImage.getPixelData();
      
      for (let y = 0; y < height; y++) {
        const sourceIndex = y * width + x;
        // Fixed orientation - don't flip Z axis unnecessarily
        const targetIndex = z * height + y;
        sagittalData[targetIndex] = sourcePixelData[sourceIndex];
      }
    }
    
    mprState.imageData.sagittal.push(sagittalData);
    
    // Progress update every 20 slices
    if (x % 20 === 0) {
      updateStatus(`Generating sagittal ${x + 1}/${width}...`);
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }

  updateStatus("Generating coronal reconstructions...");
  
  // Generate coronal slices (XZ plane) - Fixed algorithm  
  mprState.imageData.coronal = [];
  for (let y = 0; y < height; y++) {
    const coronalData = new Uint16Array(width * depth);
    
    for (let z = 0; z < depth; z++) {
      const sourceImage = mprState.volumeData[z];
      const sourcePixelData = sourceImage.getPixelData();
      
      for (let x = 0; x < width; x++) {
        const sourceIndex = y * width + x;
        // Fixed orientation
        const targetIndex = z * width + x;
        coronalData[targetIndex] = sourcePixelData[sourceIndex];
      }
    }
    
    mprState.imageData.coronal.push(coronalData);
    
    // Progress update every 20 slices
    if (y % 20 === 0) {
      updateStatus(`Generating coronal ${y + 1}/${height}...`);
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
  
  updateStatus("MPR reconstruction complete");
}

// Fixed synthetic image creation with proper metadata
function createSyntheticImage(pixelData, width, height, referenceImage, orientation) {
  if (!pixelData || pixelData.length === 0) {
    throw new Error("Invalid pixel data for synthetic image");
  }

  // Create a proper image object that cornerstone can handle
  const syntheticImage = {
    imageId: `synthetic://mpr/${orientation}/${Date.now()}/${Math.random()}`,
    minPixelValue: referenceImage.minPixelValue || 0,
    maxPixelValue: referenceImage.maxPixelValue || 4095,
    slope: referenceImage.slope || 1,
    intercept: referenceImage.intercept || 0,
    windowCenter: referenceImage.windowCenter || 512,
    windowWidth: referenceImage.windowWidth || 1024,
    getPixelData: () => pixelData,
    rows: height,
    columns: width,
    height: height,
    width: width,
    color: false,
    columnPixelSpacing: referenceImage.columnPixelSpacing || 1,
    rowPixelSpacing: referenceImage.rowPixelSpacing || 1,
    invert: false,
    sizeInBytes: pixelData.length * 2,
    // Add required properties for cornerstone
    cachedLut: referenceImage.cachedLut,
    rgba: false,
    photometricInterpretation: referenceImage.photometricInterpretation || 'MONOCHROME2',
    planarConfiguration: 0
  };

  return syntheticImage;
}

// Fixed MPR views rendering with better error handling
async function renderMPRViews() {
  if (!mprState.volumeData || mprState.volumeData.length === 0) {
    throw new Error("No volume data available for rendering");
  }

  const { width, height, depth } = mprState.dimensions;
  const { x, y, z } = mprState.crosshairPosition;
  const referenceImage = mprState.volumeData[0];

  // Calculate slice indices with proper bounds checking
  const axialIndex = Math.max(0, Math.min(depth - 1, Math.floor(z * depth)));
  const sagittalIndex = Math.max(0, Math.min(width - 1, Math.floor(x * width)));
  const coronalIndex = Math.max(0, Math.min(height - 1, Math.floor(y * height)));

  // Update current slice tracking
  mprState.currentSlices = { axial: axialIndex, sagittal: sagittalIndex, coronal: coronalIndex };

  try {
    // Render axial view (original images)
    if (mprState.viewports.axial && mprState.volumeData[axialIndex]) {
      const axialImage = mprState.volumeData[axialIndex];
      await cornerstone.displayImage(mprState.viewports.axial, axialImage);
      updateSliceInfo('axial', axialIndex + 1, depth);
    }

    // Render sagittal view with validation
    if (mprState.viewports.sagittal && mprState.imageData.sagittal[sagittalIndex]) {
      const sagittalPixelData = mprState.imageData.sagittal[sagittalIndex];
      if (sagittalPixelData && sagittalPixelData.length > 0) {
        const sagittalImage = createSyntheticImage(
          sagittalPixelData,
          height,
          depth,
          referenceImage,
          'sagittal'
        );
        await cornerstone.displayImage(mprState.viewports.sagittal, sagittalImage);
        updateSliceInfo('sagittal', sagittalIndex + 1, width);
      }
    }

    // Render coronal view with validation
    if (mprState.viewports.coronal && mprState.imageData.coronal[coronalIndex]) {
      const coronalPixelData = mprState.imageData.coronal[coronalIndex];
      if (coronalPixelData && coronalPixelData.length > 0) {
        const coronalImage = createSyntheticImage(
          coronalPixelData,
          width,
          depth,
          referenceImage,
          'coronal'
        );
        await cornerstone.displayImage(mprState.viewports.coronal, coronalImage);
        updateSliceInfo('coronal', coronalIndex + 1, height);
      }
    }

    // Update crosshairs after successful rendering
    updateAllCrosshairs();
    
    // Update position display
    updateMPRPosition();

  } catch (error) {
    console.error("Error rendering MPR views:", error);
    throw new Error("Failed to render MPR views: " + error.message);
  }
}

// Update slice information display
function updateSliceInfo(plane, currentSlice, totalSlices) {
  const sliceInfoEl = document.getElementById(`${plane}SliceInfo`);
  if (sliceInfoEl) {
    sliceInfoEl.textContent = `Slice: ${currentSlice}/${totalSlices}`;
  }
}

// Update MPR position display
function updateMPRPosition() {
  const positionEl = document.getElementById("mprPosition");
  if (positionEl) {
    const pos = mprState.crosshairPosition;
    positionEl.textContent = `Position: (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`;
  }
}

// Enhanced viewport interaction with better coordinate handling
function setupMPRSynchronization() {
  // Remove existing event listeners
  Object.values(mprState.viewports).forEach(viewport => {
    if (viewport && viewport._mprClickHandler) {
      viewport.removeEventListener('click', viewport._mprClickHandler);
      viewport._mprClickHandler = null;
    }
  });

  // Add click handlers for crosshair interaction
  setupViewportInteraction(mprState.viewports.axial, 'axial');
  setupViewportInteraction(mprState.viewports.sagittal, 'sagittal');
  setupViewportInteraction(mprState.viewports.coronal, 'coronal');
}

// Fixed viewport interaction with proper coordinate mapping
function setupViewportInteraction(viewport, plane) {
  if (!viewport) return;

  const clickHandler = (event) => {
    event.preventDefault();
    
    const rect = viewport.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

    // Update crosshair position based on which plane was clicked
    switch (plane) {
      case 'axial':
        mprState.crosshairPosition.x = x;
        mprState.crosshairPosition.y = y;
        break;
      case 'sagittal':
        mprState.crosshairPosition.y = x;
        mprState.crosshairPosition.z = y;
        break;
      case 'coronal':
        mprState.crosshairPosition.x = x;
        mprState.crosshairPosition.z = y;
        break;
    }

    // Re-render all views
    renderMPRViews().catch(error => {
      console.error("Error re-rendering MPR views:", error);
    });
  };

  viewport._mprClickHandler = clickHandler;
  viewport.addEventListener('click', clickHandler);
  viewport.style.cursor = 'crosshair';
  
  // Add hover effect
  viewport.addEventListener('mouseenter', () => {
    viewport.style.borderColor = '#00ff00';
  });
  
  viewport.addEventListener('mouseleave', () => {
    viewport.style.borderColor = '#374151';
  });
}

// Enhanced crosshair rendering
function updateAllCrosshairs() {
  updateCrosshairForViewport(mprState.viewports.axial, 'axial');
  updateCrosshairForViewport(mprState.viewports.sagittal, 'sagittal');
  updateCrosshairForViewport(mprState.viewports.coronal, 'coronal');
}

// Fixed crosshair positioning
function updateCrosshairForViewport(viewport, plane) {
  if (!viewport) return;

  // Remove existing crosshairs
  const existingCrosshairs = viewport.querySelectorAll('.mpr-crosshair');
  existingCrosshairs.forEach(el => el.remove());

  // Create new crosshairs
  const crosshairContainer = document.createElement('div');
  crosshairContainer.className = 'mpr-crosshair';
  crosshairContainer.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 10;
  `;

  const hLine = document.createElement('div');
  const vLine = document.createElement('div');
  
  const crosshairStyle = `
    position: absolute;
    background: #00ff00;
    box-shadow: 0 0 3px rgba(0, 255, 0, 0.8), inset 0 0 3px rgba(0, 255, 0, 0.4);
    opacity: 0.8;
  `;
  
  hLine.style.cssText = crosshairStyle + `
    height: 1px;
    width: 100%;
    left: 0;
  `;
  
  vLine.style.cssText = crosshairStyle + `
    width: 1px;
    height: 100%;
    top: 0;
  `;

  // Position crosshairs based on current position and plane
  const { x, y, z } = mprState.crosshairPosition;
  
  switch (plane) {
    case 'axial':
      hLine.style.top = `${y * 100}%`;
      vLine.style.left = `${x * 100}%`;
      break;
    case 'sagittal':
      hLine.style.top = `${z * 100}%`;
      vLine.style.left = `${y * 100}%`;
      break;
    case 'coronal':
      hLine.style.top = `${z * 100}%`;
      vLine.style.left = `${x * 100}%`;
      break;
  }

  crosshairContainer.appendChild(hLine);
  crosshairContainer.appendChild(vLine);
  
  // Ensure viewport has relative positioning
  if (viewport.style.position !== 'relative') {
    viewport.style.position = 'relative';
  }
  viewport.appendChild(crosshairContainer);
}

// Enhanced viewport labeling
function addViewportLabel(viewport, label, color = "#00ff00") {
  const labelEl = document.createElement('div');
  labelEl.textContent = label;
  labelEl.style.cssText = `
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(0, 0, 0, 0.8);
    color: ${color};
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: bold;
    z-index: 15;
    pointer-events: none;
    border: 1px solid ${color};
    font-family: monospace;
  `;
  
  if (viewport.style.position !== 'relative') {
    viewport.style.position = 'relative';
  }
  viewport.appendChild(labelEl);
}

// Enhanced deactivation with proper cleanup
function deactivateMPR() {
  const container = document.getElementById("mprContainer");
  const normalViewport = document.getElementById("viewportContainer");
  const dicomImage = document.getElementById("dicomImage");

  // Hide MPR container
  if (container) container.style.display = "none";

  // Show normal view
  if (normalViewport) normalViewport.style.display = "block";
  if (dicomImage) dicomImage.style.display = "block";

  // Clean up event listeners
  Object.values(mprState.viewports).forEach(viewport => {
    if (viewport && viewport._mprClickHandler) {
      viewport.removeEventListener('click', viewport._mprClickHandler);
      viewport._mprClickHandler = null;
    }
  });

  // Disable cornerstone on MPR viewports
  Object.values(mprState.viewports).forEach(viewport => {
    if (viewport) {
      try {
        // Clear content first
        const crosshairs = viewport.querySelectorAll('.mpr-crosshair');
        crosshairs.forEach(el => el.remove());
        
        // Disable cornerstone
        if (cornerstone.getEnabledElements().some(e => e.element === viewport)) {
          cornerstone.disable(viewport);
        }
      } catch (e) {
        console.warn("Error during MPR cleanup:", e);
      }
    }
  });

  // Reset MPR state
  mprState.isActive = false;
  mprState.volumeData = null;
  mprState.imageData = { axial: [], sagittal: [], coronal: [] };
  mprState.viewports = { axial: null, sagittal: null, coronal: null };
  mprState.crosshairPosition = { x: 0.5, y: 0.5, z: 0.5 };
  mprState.currentSlices = { axial: 0, sagittal: 0, coronal: 0 };

  updateStatus("MPR mode deactivated");
}

// Enhanced keyboard controls
document.addEventListener("keydown", function (e) {
  if (!mprState.isActive) return;

  const step = 0.02; // 2% step for crosshair movement

  switch (e.keyCode) {
    case 87: // W - move up
      e.preventDefault();
      mprState.crosshairPosition.y = Math.max(0, mprState.crosshairPosition.y - step);
      renderMPRViews();
      break;
    case 83: // S - move down
      e.preventDefault();
      mprState.crosshairPosition.y = Math.min(1, mprState.crosshairPosition.y + step);
      renderMPRViews();
      break;
    case 65: // A - move left
      e.preventDefault();
      mprState.crosshairPosition.x = Math.max(0, mprState.crosshairPosition.x - step);
      renderMPRViews();
      break;
    case 68: // D - move right
      e.preventDefault();
      mprState.crosshairPosition.x = Math.min(1, mprState.crosshairPosition.x + step);
      renderMPRViews();
      break;
    case 81: // Q - move slice up
      e.preventDefault();
      mprState.crosshairPosition.z = Math.max(0, mprState.crosshairPosition.z - step);
      renderMPRViews();
      break;
    case 69: // E - move slice down
      e.preventDefault();
      mprState.crosshairPosition.z = Math.min(1, mprState.crosshairPosition.z + step);
      renderMPRViews();
      break;
    case 27: // Escape - exit MPR
      e.preventDefault();
      deactivateMPR();
      break;
    case 67: // C - center crosshair
      e.preventDefault();
      mprState.crosshairPosition = { x: 0.5, y: 0.5, z: 0.5 };
      renderMPRViews();
      break;
  }
});

// Enhanced tool setup for MPR viewports
function setupMPRTools() {
  if (!mprState.isActive) return;

  Object.entries(mprState.viewports).forEach(([plane, viewport]) => {
    if (viewport && cornerstone.getEnabledElements().some(e => e.element === viewport)) {
      try {
        // Setup basic tools for each viewport
        cornerstoneTools.addTool(cornerstoneTools.WwwcTool);
        cornerstoneTools.addTool(cornerstoneTools.ZoomTool);
        cornerstoneTools.addTool(cornerstoneTools.PanTool);
        
        cornerstoneTools.setToolActive("Wwwc", { mouseButtonMask: 1 }, viewport);
        cornerstoneTools.setToolActive("Zoom", { mouseButtonMask: 2 }, viewport);
        cornerstoneTools.setToolActive("Pan", { mouseButtonMask: 4 }, viewport);

        // Add viewport change listener for synchronization
        viewport.addEventListener('cornerstoneimagerendered', (e) => {
          const eventData = e.detail;
          if (eventData && eventData.viewport && eventData.viewport.voi) {
            // Optional: synchronize window/level across viewports
            // synchronizeWindowLevel(viewport, eventData.viewport.voi.windowCenter, eventData.viewport.voi.windowWidth);
          }
        });
      } catch (error) {
        console.warn(`Error setting up tools for ${plane} viewport:`, error);
      }
    }
  });
}

// Add button event listeners
document.addEventListener('DOMContentLoaded', function() {
  const mprBtn = document.getElementById("mprTool");
  const exitBtn = document.getElementById("mprExitBtn");
  const resetBtn = document.getElementById("mprResetBtn");

  
  if (mprBtn) {
    mprBtn.addEventListener("click", () => activateMPR());
  }
  
  if (exitBtn) {
    exitBtn.addEventListener("click", () => deactivateMPR());
  }
  

  
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      mprState.crosshairPosition = { x: 0.5, y: 0.5, z: 0.5 };
      if (mprState.isActive) {
        renderMPRViews();
      }
    });
  }
});




// Load PACS data
async function loadPacsData(folderId) {
  //console.log('Loading PACS data for folder ID:', folderId);
  showLoading(true, "Loading PACS study...");

  try {
    const pacsServerUrl = sessionStorage.getItem("pacsServerUrl");
    const studyId = sessionStorage.getItem("pacsStudyId");

    if (!pacsServerUrl || !studyId) {
      throw new Error("PACS server URL or study ID not found in session");
    }

    // console.log("Loading PACS study:", studyId, "from", pacsServerUrl);

    // Get authentication headers
    const headers = {
      'Content-Type': 'application/json',
    };

    // Add basic auth if credentials exist
    const username = sessionStorage.getItem('pacsUsername');
    const password = sessionStorage.getItem('pacsPassword');
    // const username = "harsh";
    // const password = '12345';
    if (username && password) {
      headers['Authorization'] = 'Basic ' + btoa(username + ':' + password);
    }

    // Get series list
    const seriesRes = await fetch(`${pacsServerUrl}/studies/${studyId}/series`, {
      method: 'GET',
      headers: headers
    });
    
    if (!seriesRes.ok) {
      throw new Error(`Failed to fetch series: ${seriesRes.status}`);
    }

    const seriesList = await seriesRes.json();
    // console.log("Series List:", seriesList);

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
        // const seriesDetailsRes = await fetch(`${pacsServerUrl}/series/${seriesId}`, {
      //  http://localhost:5000/orthanc/studies/f5fb48d5-af3afd53-088f1223-6ffab861-8d76e2be
        const seriesDetailsRes = await fetch(`${pacsServerUrl}/studies/${studyId}`, {
          headers: headers
        });
        const seriesDetails = await seriesDetailsRes.json();
        // console.log(seriesDetails);
        
        // Get instances in this series
        const instancesRes = await fetch(`${pacsServerUrl}/series/${seriesId}/instances`, {
          headers: headers
        });
        const instances = await instancesRes.json();
        
        // console.log(`Series ${seriesId} has ${instances.length} instances`);

        if (instances.length === 0) {
          console.warn(`No instances found in series ${seriesId}`);
          continue;
        }

        const seriesKey = `${studyId}_${seriesId}`;
        tempSeries[seriesKey] = {
          seriesInstanceUID: seriesId,
          studyInstanceUID: studyId,
          patientName: seriesDetails.PatientMainDicomTags?.PatientName || "Unknown Patient",
          studyDescription: seriesDetails.MainDicomTags?.StudyDescription || "PACS Study",
          seriesDescription: seriesDetails.MainDicomTags?.SeriesDescription || `Series ${i + 1}`,
          seriesNumber: seriesDetails.MainDicomTags?.SeriesNumber || (i + 1),
          studyDate: formatDate(seriesDetails.MainDicomTags?.StudyDate || ""),
          studyTime: formatTime(seriesDetails.MainDicomTags?.StudyTime || ""),
          modality: seriesDetails.MainDicomTags?.Modality || "UN",
          images: [],
        };

        // Process each instance
       
    for (let j = 0; j < instances.length; j++) {
    const instanceData = instances[j];
    const instanceId = instanceData.ID || instanceData.id; // Extract the actual ID
    
    updateStatus(`Loading series ${i + 1}/${seriesList.length}, image ${j + 1}/${instances.length}...`);
    
          try {
            // Get DICOM file
            const fileRes = await fetch(`${pacsServerUrl}/instances/${instanceId}/file`, {
              headers: headers
            });
            
            if (!fileRes.ok) {
              console.warn(`Failed to fetch instance ${instanceId}: ${fileRes.status}`);
              continue;
            }

            const dicomArrayBuffer = await fileRes.arrayBuffer();
            const blob = new Blob([dicomArrayBuffer], { type: "application/dicom" });
            const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);

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
            console.error(`Error loading instance ${instanceId}:`, instanceError);
          }
        }

        // Sort images by instance number
        tempSeries[seriesKey].images.sort((a, b) => a.instanceNumber - b.instanceNumber);

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
  console.log('Loading DICOM data from IndexedDB for folder ID:', folderId);

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
    console.error('Error loading DICOM data from IndexedDB:', error);
    
    // Fallback to localStorage method
    console.log('Falling back to localStorage method...');
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
            type: fileRecord.type || "application/dicom" 
          });
        } else {
          console.warn("Unsupported file data type for:", fileRecord.name);
          processedFiles++;
          continue;
        }
      }

      // Create cornerstone image ID
      const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(dicomFile);

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

      if (typeof loadingText !== 'undefined' && loadingText) {
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
  console.log('Loading DICOM data for folder ID:', folderId);

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
    console.error('Error loading DICOM data:', error);
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
  //console.log("Processing stored DICOM files from localStorage...");

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
      const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(dicomFile);

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

      if (typeof loadingText !== 'undefined' && loadingText) {
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
  //console.log("Finalizing series with", validFiles, "valid files");
  // console.log("TempSeries data:", tempSeries);

  if (validFiles === 0) {
    showError("No valid DICOM files found!");
    showLoading(false);
    return;
  }

  // Convert tempSeries to the correct format that the UI expects
  allSeries = {}; // Reset the global allSeries object
  
  // Convert each series in tempSeries to the expected format
  Object.keys(tempSeries).forEach(key => {
    allSeries[key] = tempSeries[key];
  });

  //console.log("Final allSeries:", allSeries);

  // Create the series UI - this is the key fix!
  createSeriesUI();

  // Load first image if available
  const firstSeriesKey = Object.keys(allSeries)[0];
  if (firstSeriesKey && allSeries[firstSeriesKey].images.length > 0) {
   // console.log("Loading first series:", firstSeriesKey);
    
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
  updateStatus(`Loaded ${Object.keys(allSeries).length} series with ${validFiles} images`);
}

// FIXED: Create series UI - This function was missing proper implementation
function createSeriesUI() {
  //console.log("Creating series UI...", allSeries);
  
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
    // console.log("Creating UI for series:", seriesKey, series);

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
          ${series.seriesDescription || 'Unnamed Series'}
        </div>
        <div class="series-info" style="font-size: 0.85em; color: #666;">
          ${series.modality || 'UN'} • ${series.patientName || 'Unknown Patient'}
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
          thumbnail.style.borderColor = '#007bff';
          thumbnail.style.transform = 'scale(1.05)';
        };
        
        thumbnail.onmouseleave = () => {
          if (!thumbnail.classList.contains('selected')) {
            thumbnail.style.borderColor = '#ddd';
          }
          thumbnail.style.transform = 'scale(1)';
        };

        const loadingDiv = document.createElement("div");
        loadingDiv.className = "thumbnail-loading";
        loadingDiv.innerHTML = '<i class="fas fa-spinner fa-spin" style="color: #007bff;"></i>';
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

//  console.log("Series UI created successfully");
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
      // console.error(`Thumbnail load error for ${imageId}:`, error);
      if (loadingDiv) {
        loadingDiv.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: #dc3545;"></i>';
      }
    });
}
// Toggle series expansion function
function toggleSeries(seriesKey) {
  console.log('Toggling series:', seriesKey); // Better debugging than debugger
  
  const seriesItem = document.getElementById(`series_${seriesKey}`);
  
  if (!seriesItem) {
    console.error(`Series item with ID 'series_${seriesKey}' not found`);
    return;
  }
  
  // Toggle the collapsed state
  seriesItem.classList.toggle("series-collapsed");
  
  // Rotate the chevron icon
  const expandIcon = seriesItem.querySelector('.expand-icon');
  if (expandIcon) {
    const isCollapsed = seriesItem.classList.contains("series-collapsed");
    expandIcon.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    expandIcon.style.transition = 'transform 0.3s ease'; // Smooth animation
  } else {
    console.warn('Expand icon not found in series item');
  }
}
// FIXED: Select series and image - This was the main issue!
function selectSeries(seriesKey, imageIndex = 0) {
 // console.log("Selecting series:", seriesKey, "image:", imageIndex);

  const series = allSeries[seriesKey];
  if (!series || !series.images[imageIndex]) {
    console.error("Series or image not found", { seriesKey, imageIndex, series });
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
  // console.log("Loading image ID:", imageId);

  // Load and display the image
  cornerstone.loadImage(imageId)
    .then((image) => {
     // console.log("Image loaded successfully, displaying...");
      
      // Display the image
      cornerstone.displayImage(el, image);
      
      // console.log("Image displayed successfully");
      
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
  document.querySelectorAll('.thumbnail.selected').forEach(thumb => {
    thumb.classList.remove('selected');
    thumb.style.borderColor = '#ddd';
  });
  
  // Add selection to current thumbnail
  const thumbnailsGrid = document.getElementById(`thumbnails_${seriesKey}`);
  if (thumbnailsGrid) {
    const thumbnails = thumbnailsGrid.querySelectorAll('.thumbnail');
    if (thumbnails[imageIndex]) {
      thumbnails[imageIndex].classList.add('selected');
      thumbnails[imageIndex].style.borderColor = '#007bff';
      thumbnails[imageIndex].style.borderWidth = '3px';
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
// console.log(series);

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
    bottomLeft.innerHTML = `Series: ${series.seriesDescription}<br>Image: ${currentImageIndex + 1}/${series.images.length}`;
  }

  // Get viewport info from the active element
  const activeElement = getActiveElement();
  if (activeElement && cornerstone.getEnabledElements().some((e) => e.element === activeElement)) {
    try {
      const viewport = cornerstone.getViewport(activeElement);
      if (bottomRight) {
        bottomRight.innerHTML = `WW/WC: ${Math.round(viewport.voi.windowWidth)}/${Math.round(viewport.voi.windowCenter)}<br>Zoom: ${viewport.scale.toFixed(1)}x`;
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
  const progress = series.images.length > 1 ? (currentImageIndex / (series.images.length - 1)) * 100 : 0;
  if (progressFill) progressFill.style.width = progress + "%";
  if (progressThumb) progressThumb.style.left = progress + "%";

  // Update time displays
  if (currentTimeDisplay) currentTimeDisplay.textContent = `${currentImageIndex + 1} / ${series.images.length}`;
  if (totalTimeDisplay) totalTimeDisplay.textContent = series.images.length.toString();

  // Update button states
  if (firstBtn) firstBtn.disabled = currentImageIndex === 0;
  if (prevBtn) prevBtn.disabled = currentImageIndex === 0 && !isLooping;
  if (nextBtn) nextBtn.disabled = currentImageIndex === series.images.length - 1 && !isLooping;
  if (lastBtn) lastBtn.disabled = currentImageIndex === series.images.length - 1;

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
    loopBtn.style.background = isLooping ? "rgba(16, 185, 129, 0.9)" : "rgba(59, 130, 246, 0.9)";
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
  if (isDragging) return;

  const rect = progressBar.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const percentage = Math.max(0, Math.min(1, clickX / rect.width));

  const series = allSeries[currentSeriesId];
  if (series) {
    const targetIndex = Math.round(percentage * (series.images.length - 1));
    goToImage(targetIndex);
  }
}

// let isDragging = false;

// function startDrag(e) {
//   e.preventDefault();
//   isDragging = true;
//   if (progressThumb) progressThumb.style.cursor = "grabbing";
// }

// function handleDrag(e) {
//   if (!isDragging) return;

//   const rect = progressBar.getBoundingClientRect();
//   const dragX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
//   const percentage = dragX / rect.width;

//   const series = allSeries[currentSeriesId];
//   if (series) {
//     const targetIndex = Math.round(percentage * (series.images.length - 1));
//     goToImage(targetIndex);
//   }
// }

// function endDrag() {
//   isDragging = false;
//   if (progressThumb) progressThumb.style.cursor = "grab";
// }

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
  if (!activeElement || !cornerstone.getEnabledElements().some((e) => e.element === activeElement)) {
    return;
  }

  if (!cornerstone.getEnabledElement(activeElement)) return;

  document.querySelectorAll(".tool-btn").forEach((btn) => btn.classList.remove("active"));

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
  if (!activeElement || !cornerstone.getEnabledElements().some((e) => e.element === activeElement)) {
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
  if (!activeElement || !cornerstone.getEnabledElements().some((e) => e.element === activeElement)) {
    return;
  }

  if (!cornerstone.getEnabledElement(activeElement)) return;

  const viewport = cornerstone.getViewport(activeElement);
  viewport.invert = !viewport.invert;
  cornerstone.setViewport(activeElement, viewport);
}

function resetViewport() {
  const activeElement = getActiveElement();
  if (!activeElement || !cornerstone.getEnabledElements().some((e) => e.element === activeElement)) {
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
    if (container) {
      container.innerHTML = "";
      container.style.display = "none";
    }
    if (dicomImage) dicomImage.style.display = "block";

    ensureEnabled(dicomImage);
    activeViewport = dicomImage;

    // Repaint current image if we have one
    const series = allSeries[currentSeriesId];
    if (series && series.images[currentImageIndex]) {
      displayImageInto(dicomImage, series.images[currentImageIndex].imageId);
      setupToolsForViewport(dicomImage);
    }
    return;
  }

  // Grid layout
  if (dicomImage) dicomImage.style.display = "none";
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
  activeViewport = gridViewports[0];

  // Repaint current image into first cell (if any)
  const series = allSeries[currentSeriesId];
  if (series && series.images[currentImageIndex]) {
    const imageId = series.images[currentImageIndex].imageId;
    displayImageInto(activeViewport, imageId);
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
  const isEnabled = cornerstone.getEnabledElements().some((e) => e.element === el);
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
    return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
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
  // console.log("Status:", message);
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
  
  // console.log(show ? `Loading: ${message}` : "Loading finished");
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
      if (cornerstoneWADOImageLoader && cornerstoneWADOImageLoader.wadouri && cornerstoneWADOImageLoader.wadouri.dataSetCacheManager) {
        dataSet = cornerstoneWADOImageLoader.wadouri.dataSetCacheManager.get(imageId);
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
          const arrayBuffer = reloadedImage.data.byteArray.buffer || reloadedImage.data.byteArray;
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
      html += `<p>Pixel Spacing: ${image.pixelSpacing ? image.pixelSpacing.join(", ") : "Unknown"}</p>`;
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
  html += "<tr><th style='width: 15%'>Tag</th><th style='width: 35%'>Name</th><th style='width: 50%'>Value</th></tr>";
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
          <strong>Total Tags:</strong> ${Object.keys(dataSet.elements).length}<br>
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
    html += "<tr><td colspan='3' class='table-secondary text-center'><strong>Other Tags</strong></td></tr>";
  }

  // Then add remaining tags
  const remainingTags = Object.keys(dataSet.elements).filter((tag) => !addedTags.has(tag));
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
      if (cornerstoneWADOImageLoader && cornerstoneWADOImageLoader.wadouri && cornerstoneWADOImageLoader.wadouri.dataSetCacheManager) {
        dataSet = cornerstoneWADOImageLoader.wadouri.dataSetCacheManager.get(imageId);
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
        if (value.includes(",") || value.includes('"') || value.includes("\n")) {
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

window.activateMPR = activateMPR;
window.deactivateMPR = deactivateMPR;
window.mprState = mprState;
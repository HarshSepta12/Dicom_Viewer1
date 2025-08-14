// Initialize Cornerstone
cornerstoneTools.external.Hammer = Hammer;
cornerstoneTools.external.cornerstone = cornerstone;
cornerstoneWADOImageLoader.external.dicomParser = dicomParser;
cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
cornerstoneTools.external.cornerstoneMath = cornerstoneMath;

cornerstoneTools.init({
  showSVGCursors: true,
});

// Global variables for series state
let allSeries = {};
let currentSeriesId = null;
let currentImageIndex = 0;
let loaded = false;


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
const fileInput = document.getElementById("fileInput");
const folderInput = document.getElementById("folderInput");
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

// Cine control event listeners
playPauseBtn.addEventListener("click", togglePlayback);
prevBtn.addEventListener("click", () => changeImage(-1));
nextBtn.addEventListener("click", () => changeImage(1));
firstBtn.addEventListener("click", () => goToImage(0));
lastBtn.addEventListener("click", () => {
  const series = allSeries[currentSeriesId];
  if (series) goToImage(series.images.length - 1);
});
loopBtn.addEventListener("click", toggleLoop);

// Speed control buttons
document.querySelectorAll(".speed-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const speed = parseFloat(btn.dataset.speed);
    if (speed) setPlaybackSpeed(speed);
  });
});

// Progress bar interactions
progressBar.addEventListener("click", handleProgressClick);

let isDragging = false;
progressThumb.addEventListener("mousedown", startDrag);
document.addEventListener("mousemove", handleDrag);
document.addEventListener("mouseup", endDrag);

document.addEventListener("DOMContentLoaded", function () {
  if (dicomImage) {
    cornerstone.enable(dicomImage);
    activeViewport = dicomImage;
  }
});

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
  playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';

  const frameRate = 1000 / (10 * playbackSpeed); // Base 10 FPS

  // Clear any existing interval first
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
  playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';

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
    setTimeout(() => startPlayback(), 100); // Small delay to ensure clean restart
  }
}


function toggleLoop() {
  isLooping = !isLooping;
  loopBtn.style.opacity = isLooping ? "1" : "0.5";
  loopBtn.style.background = isLooping
    ? "rgba(16, 185, 129, 0.9)"
    : "rgba(59, 130, 246, 0.9)";
}

function goToImage(index) {
  const series = allSeries[currentSeriesId];
  if (!series) return;

  const clampedIndex = Math.max(0, Math.min(series.images.length - 1, index));
  selectSeries(currentSeriesId, clampedIndex);
}

function updateCineControls() {
  const series = allSeries[currentSeriesId];
  if (!series) {
    cineControls.style.display = "none";
    return;
  }

  cineControls.style.display = "block";

  // Update progress
  const progress =
    series.images.length > 1
      ? (currentImageIndex / (series.images.length - 1)) * 100
      : 0;
      
      
  progressFill.style.width = progress + "%";
  progressThumb.style.left = progress + "%";

  // Update time displays
  currentTimeDisplay.textContent = `${currentImageIndex + 1} / ${
    series.images.length
  }`;
  totalTimeDisplay.textContent = series.images.length.toString();

  // Update button states
  firstBtn.disabled = currentImageIndex === 0;
  prevBtn.disabled = currentImageIndex === 0 && !isLooping;
  nextBtn.disabled =
    currentImageIndex === series.images.length - 1 && !isLooping;
  lastBtn.disabled = currentImageIndex === series.images.length - 1;

  // Show/hide controls based on series length
  const shouldShow = series.images.length > 1;
  cineControls.style.display = shouldShow ? "block" : "none";
}

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

function startDrag(e) {
  e.preventDefault();
  isDragging = true;
  progressThumb.style.cursor = "grabbing";
}

function handleDrag(e) {
  if (!isDragging) return;

  const rect = progressBar.getBoundingClientRect();
  const dragX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const percentage = dragX / rect.width;

  const series = allSeries[currentSeriesId];
  if (series) {
    const targetIndex = Math.round(percentage * (series.images.length - 1));
    goToImage(targetIndex);
  }
}

function endDrag() {
  isDragging = false;
  progressThumb.style.cursor = "grab";
}

// Auto-hide cine controls
let controlsTimeout;
const viewerArea = document.querySelector(".viewer-area");

function showCineControls() {
  cineControls.classList.remove("auto-hide");
  clearTimeout(controlsTimeout);

  controlsTimeout = setTimeout(() => {
    if (!isPlaying) {
      cineControls.classList.add("auto-hide");
    }
  }, 3000);
}

function hideCineControls() {
  if (!isPlaying) {
    cineControls.classList.add("auto-hide");
  }
}   

viewerArea.addEventListener("mousemove", showCineControls);
viewerArea.addEventListener("mouseleave", hideCineControls);
cineControls.addEventListener("mouseenter", () => {
  clearTimeout(controlsTimeout);
  cineControls.classList.remove("auto-hide");
});

// Drag and drop functionality
uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("dragover");
});

uploadArea.addEventListener("dragleave", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("dragover");
});

uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("dragover");
  handleFileUpload(e.dataTransfer.files);
});

uploadArea.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    handleFileUpload(e.target.files);
    e.target.value = "";
  }
});

folderInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    handleFileUpload(e.target.files);
    e.target.value = "";
  }
});

// Dropdown functionality
document.getElementById("annotationTool").addEventListener("click", (e) => {
  e.stopPropagation();
  toggleDropdown("annotationDropdown");
});

document.getElementById("layoutTool").addEventListener("click", (e) => {
  e.stopPropagation();
  toggleDropdown("layoutDropdown");
});

document.addEventListener("click", () => {
  closeAllDropdowns();
});

function toggleDropdown(dropdownId) {
  closeAllDropdowns();
  document.getElementById(dropdownId).classList.add("show");
}

function closeAllDropdowns() {
  document.querySelectorAll(".tool-dropdown").forEach((dropdown) => {
    dropdown.classList.remove("show");
  });
}

// File upload handling with proper series grouping
function handleFileUpload(files) {
  showLoading(true);
  updateStatus(`Processing ${files.length} files...`);

  const dicomFiles = Array.from(files).filter((file) => {
    const name = file.name.toLowerCase();
    return (
      name.endsWith(".dcm") ||
      name.endsWith(".dicom") ||
      name.includes("dicom") ||
      file.type === "application/dicom" ||
      file.type === "" ||
      file.size > 1024
    );
  });

  if (dicomFiles.length === 0) {
    showError(
      `No DICOM files found in ${files.length} uploaded files. Please ensure files have .dcm extension or contain DICOM data.`
    );
    showLoading(false);
    return;
  }

  showSuccess(
    `Found ${dicomFiles.length} potential DICOM files. Processing...`
  );
  processDicomFiles(dicomFiles);
}

function processDicomFiles(files) {
  const tempSeries = {};
  let processedFiles = 0;
  let validFiles = 0;

  loadingText.textContent = `Processing DICOM files... (0/${files.length})`;

  files.forEach((file, index) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const arrayBuffer = e.target.result;
        const byteArray = new Uint8Array(arrayBuffer);

        let dataSet;
        try {
          dataSet = dicomParser.parseDicom(byteArray);
        } catch (parseError) {
          console.warn("DICOM parse error for file:", file.name, parseError);
          processedFiles++;
          updateProgress((processedFiles / files.length) * 100);
          loadingText.textContent = `Processing DICOM files... (${processedFiles}/${files.length})`;

          if (processedFiles === files.length) {
            finalizeSeries(tempSeries, validFiles);
          }
          return;
        }

        const imageId =
          cornerstoneWADOImageLoader.wadouri.fileManager.add(file);

        const seriesInstanceUID =
          getMetadataValue(dataSet, "x0020000e") ||
          `unknown_series_${Math.random().toString(36).substr(2, 9)}`;
        const studyInstanceUID =
          getMetadataValue(dataSet, "x0020000d") || "unknown_study";
        const patientName =
          getMetadataValue(dataSet, "x00100010") || "Unknown Patient";
        const studyDescription =
          getMetadataValue(dataSet, "x00081030") || "Unknown Study";
        const seriesDescription =
          getMetadataValue(dataSet, "x0008103e") ||
          `Series ${getMetadataValue(dataSet, "x00200011") || "Unknown"}`;
        const seriesNumber = getMetadataValue(dataSet, "x00200011") || "0";
        const instanceNumber = parseInt(
          getMetadataValue(dataSet, "x00200013") || index + 1
        );
        const studyDate = getMetadataValue(dataSet, "x00080020") || "";
        const studyTime = getMetadataValue(dataSet, "x00080030") || "";
        const modality = getMetadataValue(dataSet, "x00080060") || "UN";

        const seriesKey = `${studyInstanceUID}_${seriesInstanceUID}`;

        if (!tempSeries[seriesKey]) {
          tempSeries[seriesKey] = {
            seriesInstanceUID,
            studyInstanceUID,
            patientName,
            studyDescription,
            seriesDescription,
            seriesNumber,
            studyDate: formatDate(studyDate),
            studyTime: formatTime(studyTime),
            modality,
            images: [],
          };
        }

        tempSeries[seriesKey].images.push({
          imageId,
          instanceNumber,
          fileName: file.name,
          patientName,
          studyDescription,
          seriesDescription,
          studyDate: formatDate(studyDate),
          studyTime: formatTime(studyTime),
          modality,
        });

        validFiles++;
        processedFiles++;
        updateProgress((processedFiles / files.length) * 100);
        loadingText.textContent = `Processing DICOM files... (${processedFiles}/${files.length})`;

        if (processedFiles === files.length) {
          finalizeSeries(tempSeries, validFiles);
        }
      } catch (error) {
        console.error("Error processing file:", file.name, error);
        processedFiles++;
        updateProgress((processedFiles / files.length) * 100);
        loadingText.textContent = `Processing DICOM files... (${processedFiles}/${files.length}) - Error: ${file.name}`;

        if (processedFiles === files.length) {
          finalizeSeries(tempSeries, validFiles);
        }
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function finalizeSeries(tempSeries, validFiles) {
  if (validFiles === 0) {
    showError("No valid DICOM images found");
    showLoading(false);
    return;
  }

  Object.values(tempSeries).forEach((series) => {
    series.images.sort((a, b) => a.instanceNumber - b.instanceNumber);
  });

  allSeries = { ...allSeries, ...tempSeries };

  updateStatus(
    `Loaded ${validFiles} DICOM images in ${
      Object.keys(tempSeries).length
    } series`
  );
  createSeriesUI();

  if (!currentSeriesId && Object.keys(allSeries).length > 0) {
    const firstSeriesKey = Object.keys(allSeries)[0];
    selectSeries(firstSeriesKey, 0);
  }

  showSuccess(
    `Successfully loaded ${validFiles} DICOM images organized in ${
      Object.keys(tempSeries).length
    } series`
  );
  showLoading(false);
}

function createSeriesUI() {
  seriesContainer.innerHTML = "";

  Object.entries(allSeries).forEach(([seriesKey, series]) => {
    const seriesItem = document.createElement("div");
    seriesItem.className = "series-item";
    seriesItem.id = `series_${seriesKey}`;

    const seriesHeader = document.createElement("div");
    seriesHeader.className = "series-header";
    seriesHeader.onclick = () => toggleSeries(seriesKey);

    seriesHeader.innerHTML = `
            <div>
                <div class="series-title">${series.seriesDescription}</div>
                <div class="series-info">${series.modality} • ${series.patientName}</div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <div class="series-count">${series.images.length}</div>
                <i class="fas fa-chevron-down expand-icon"></i>
            </div>
        `;

    const thumbnailsGrid = document.createElement("div");
    thumbnailsGrid.className = "thumbnails-grid";
    thumbnailsGrid.id = `thumbnails_${seriesKey}`;

    series.images.forEach((image, index) => {
      const thumbnail = document.createElement("div");
      thumbnail.className = "thumbnail";
      thumbnail.onclick = () => selectSeries(seriesKey, index);

      const loadingDiv = document.createElement("div");
      loadingDiv.className = "thumbnail-loading";
      loadingDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      thumbnail.appendChild(loadingDiv);

      const info = document.createElement("div");
      info.className = "thumbnail-info";
      info.textContent = `${index + 1}`;
      thumbnail.appendChild(info);

      thumbnailsGrid.appendChild(thumbnail);

      setTimeout(() => {
        loadThumbnailImage(image.imageId, thumbnail, loadingDiv, index);
      }, index * 100);
    });

    seriesItem.appendChild(seriesHeader);
    seriesItem.appendChild(thumbnailsGrid);
    seriesContainer.appendChild(seriesItem);
  });
}

function loadThumbnailImage(imageId, thumbnailContainer, loadingDiv, index) {
  const canvas = document.createElement("canvas");
  canvas.className = "thumbnail-image";
  canvas.width = 76;
  canvas.height = 76;
  canvas.style.display = "none";

  cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
  cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

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
      const scaleX = 76 / image.width;
      const scaleY = 76 / image.height;
      viewport.scale = Math.min(scaleX, scaleY) * 0.85;

      if (!viewport.voi) {
        const range = image.maxPixelValue - image.minPixelValue;
        viewport.voi = {
          windowWidth: range * 0.8,
          windowCenter: image.minPixelValue + range / 2,
        };
      }

      cornerstone.displayImage(tempDiv, image, viewport);

      const cornerstoneCanvas = tempDiv.querySelector("canvas");
      if (cornerstoneCanvas) {
        const ctx = canvas.getContext("2d");
        ctx.drawImage(cornerstoneCanvas, 0, 0, 76, 76);
      }

      cornerstone.disable(tempDiv);
      document.body.removeChild(tempDiv);

      if (loadingDiv && loadingDiv.parentNode) {
        loadingDiv.remove();
      }
      canvas.style.display = "block";

      const infoElement = thumbnailContainer.querySelector(".thumbnail-info");
      thumbnailContainer.insertBefore(canvas, infoElement || null);
    })
    .catch((error) => {
      console.error(`Thumbnail load error for ${imageId}:`, error);
      if (loadingDiv) {
        loadingDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
      }
    });
}

function toggleSeries(seriesKey) {
  const seriesItem = document.getElementById(`series_${seriesKey}`);
  seriesItem.classList.toggle("series-collapsed");
}

//     function selectSeries(seriesInstanceUID, imageIndex = 0) {
//     const series = allSeries[seriesInstanceUID];
//     if (!series || !series.images[imageIndex]) return;

//     currentSeriesId = seriesInstanceUID;
//     currentImageIndex = imageIndex;

//     const element = document.getElementById('dicomImage');
//     console.log(element);

//     const imageId = series.images[imageIndex].imageId;

//     // Enable the element if not already enabled
//     try {
//         if (!cornerstone.getEnabledElements().some(el => el.element === element)) {
//             cornerstone.enable(element);
//         }
//     } catch (e) {
//         console.log('Error enabling element:', e);
//     }

//     // Load and display the image

// loadImageIntoViewport(element, imageId);

//     // Setup stack scrolling & tools
//     setupToolsForViewport(element);

//     // Update image info and UI
//     updateImageInfo();
//     updateCineControls();
//     showViewer();
// }

function selectSeries(seriesInstanceUID, imageIndex = 0) {
  const series = allSeries[seriesInstanceUID];
  if (!series || !series.images[imageIndex]) return;

  currentSeriesId = seriesInstanceUID;
  currentImageIndex = imageIndex;

  const el = getActiveElement();
  if (!el) {
    console.error("No active viewport found.");
    return;
  }
  ensureEnabled(el);

  const imageId = series.images[imageIndex].imageId;
  displayImageInto(el, imageId)
    .then(() => {
      setupToolsForViewport(el);
      updateImageInfo();
      updateCineControls();
      showViewer();
    })
    .catch((err) => console.error("Error displaying image:", err));
}

function loadImageIntoViewport(element, imageId) {
  displayImageInto(element, imageId).catch((err) => {
    console.error("Error in loadImageIntoViewport:", err);
  });
}

function setupToolsForViewport(element) {
  const series = allSeries[currentSeriesId];
  if (!series || series.images.length <= 1) return;

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

function showViewer() {
  emptyState.style.display = "none";
  dicomImage.style.display = "block";
}

function updateImageInfo() {
  if (!currentSeriesId || !allSeries[currentSeriesId]) return;

  const series = allSeries[currentSeriesId];
  const currentImage = series.images[currentImageIndex];

  document.getElementById(
    "topLeft"
  ).innerHTML = `Patient: ${series.patientName}<br>Study: ${series.studyDescription}`;

  document.getElementById(
    "topRight"
  ).innerHTML = `Date: ${series.studyDate}<br>Time: ${series.studyTime}`;

  document.getElementById("bottomLeft").innerHTML = `Series: ${
    series.seriesDescription
  }<br>Image: ${currentImageIndex + 1}/${series.images.length}`;

  // Get viewport info from the active element
  const activeElement = getActiveElement();
  if (
    !activeElement ||
    !cornerstone.getEnabledElements().some((e) => e.element === activeElement)
  )
    return;

  try {
    if (cornerstone.getEnabledElement(activeElement)) {
      const viewport = cornerstone.getViewport(activeElement);
      document.getElementById("bottomRight").innerHTML = `WW/WC: ${Math.round(
        viewport.voi.windowWidth
      )}/${Math.round(
        viewport.voi.windowCenter
      )}<br>Zoom: ${viewport.scale.toFixed(1)}x`;
    }
  } catch (error) {
    console.warn("Could not get viewport info:", error);
  }
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
  if (!dateStr || dateStr.length < 8) return "Unknown";
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  return `${day}/${month}/${year}`;
}

function formatTime(timeStr) {
  if (!timeStr || timeStr.length < 6) return "Unknown";
  const hour = timeStr.substring(0, 2);
  const minute = timeStr.substring(2, 4);
  const second = timeStr.substring(4, 6);
  return `${hour}:${minute}:${second}`;
}

function updateStatus(message) {
  statusText.textContent = message;
}

// Tool activation
function activateTool(toolName) {
  const activeElement = getActiveElement();
  if (
    !activeElement ||
    !cornerstone.getEnabledElements().some((e) => e.element === activeElement)
  )
    return;

  if (!cornerstone.getEnabledElement(activeElement)) return;

  document
    .querySelectorAll(".tool-btn")
    .forEach((btn) => btn.classList.remove("active"));

  cornerstoneTools.setToolPassive("Wwwc");
  cornerstoneTools.setToolPassive("Zoom");
  cornerstoneTools.setToolPassive("Pan");
  cornerstoneTools.setToolPassive("Magnify");

  switch (toolName) {
    case "wwwc":
      const WwwcTool = cornerstoneTools.WwwcTool;
      cornerstoneTools.addTool(WwwcTool);
      cornerstoneTools.setToolActive("Wwwc", { mouseButtonMask: 1 });
      document.getElementById("wwwcTool").classList.add("active");
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
      cornerstoneTools.setToolActive("Bidirectional", {
        mouseButtonMask: 1,
      });
      break;

    case "ellipse":
      const EllipticalRoiTool = cornerstoneTools.EllipticalRoiTool;
      cornerstoneTools.addTool(EllipticalRoiTool);
      cornerstoneTools.setToolActive("EllipticalRoi", {
        mouseButtonMask: 1,
      });
      break;

    case "rectangle":
      const RectangleRoiTool = cornerstoneTools.RectangleRoiTool;
      cornerstoneTools.addTool(RectangleRoiTool);
      cornerstoneTools.setToolActive("RectangleRoi", {
        mouseButtonMask: 1,
      });
      break;

    case "freehand":
      const FreehandRoiTool = cornerstoneTools.FreehandRoiTool;
      cornerstoneTools.addTool(FreehandRoiTool);
      cornerstoneTools.setToolActive("FreehandRoi", {
        mouseButtonMask: 1,
      });
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
      cornerstoneTools.setToolActive("ArrowAnnotate", {
        mouseButtonMask: 1,
      });
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
  )
    return;

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
  )
    return;

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
  )
    return;

  if (!cornerstone.getEnabledElement(activeElement)) return;

  cornerstone.reset(activeElement);
  updateImageInfo();
}

// Get whichever element is active right now
function getActiveElement() {
  if (currentLayout === "1x1") return dicomImage;
  return gridViewports[activeGridViewport] || null;
}

// Make sure an element is enabled for Cornerstone
function ensureEnabled(el) {
  if (!el) return false;
  const isEnabled = cornerstone
    .getEnabledElements()
    .some((e) => e.element === el);
  if (!isEnabled) cornerstone.enable(el);
  return true;
}

// Safe display into an element
async function displayImageInto(el, imageId) {
  if (!el) {
    console.error("Viewport element not found.");
    return;
  }
  ensureEnabled(el);
  const image = await cornerstone.loadImage(imageId);
  cornerstone.displayImage(el, image);
}

function changeLayout(layout) {
  currentLayout = layout;

  const container = document.getElementById("viewportContainer");
  const [rows, cols] = layout.split("x").map(Number);

  // Reset grid state
  gridViewports = [];
  activeGridViewport = 0;

  // 1x1 uses the single #dicomImage; others use the container grid
  if (rows === 1 && cols === 1) {
    // Hide grid, show single viewport
    if (container) {
      container.innerHTML = "";
      container.style.display = "none";
    }
    dicomImage.style.display = "block";

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
  dicomImage.style.display = "none";
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
      // Optional: give visual focus styling here
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

function handleSeriesSelect(seriesId) {
  let seriesData = allSeries[seriesId]; // allSeries me images ka array hoga
  loadSeriesImages(seriesData.images);
  displayFirstImage(seriesData.images[0].imageId);
}

function loadSeriesImages(images) {
  currentSeriesImages = images; // Array of cornerstone image objects
}
function showLoading(show) {
  loadingOverlay.style.display = show ? "flex" : "none";
}

function updateProgress(percent) {
  const progressFillUpload = document.getElementById("progressFill");
  const uploadProgress = document.getElementById("uploadProgress");

  if (percent > 0) {
    uploadProgress.style.display = "block";
    progressFillUpload.style.width = percent + "%";
  } else {
    uploadProgress.style.display = "none";
  }
}

function showError(message) {
  const errorDiv = document.getElementById("errorMessage");
  errorDiv.textContent = message;
  errorDiv.style.display = "block";
  setTimeout(() => {
    errorDiv.style.display = "none";
  }, 5000);
}

function showSuccess(message) {
  const successDiv = document.getElementById("successMessage");
  successDiv.textContent = message;
  successDiv.style.display = "block";
  setTimeout(() => {
    successDiv.style.display = "none";
  }, 3000);
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

  element.addEventListener("cornerstoneimagerendered", function (e) {
    updateImageInfo();
  });

  element.addEventListener("cornerstonenewimage", function (e) {
    updateImageInfo();
    updateCineControls();
  });
}

window.addEventListener("load", function () {
  setTimeout(setupViewportListeners, 1000);
});

// Load demo data
function loadSampleData() {
  showLoading(true);
  updateStatus("Loading demo data...");

  const sampleData = {
    demo_series_1: {
      seriesInstanceUID: "1.2.3.4.5.6.7.8.9.1",
      studyInstanceUID: "1.2.3.4.5.6.7.8.9",
      patientName: "Demo Patient",
      studyDescription: "PT/CT Study Demo",
      seriesDescription: "CT Series",
      seriesNumber: "1",
      studyDate: "15/01/2024",
      studyTime: "14:30:25",
      modality: "CT",
      images: [
        {
          imageId:
            "dicomweb://s3.amazonaws.com/lury/PTCTStudy/1.3.6.1.4.1.25403.52237031786.3872.20100510032220.7.dcm",
          instanceNumber: 1,
          fileName: "demo1.dcm",
          patientName: "Demo Patient",
          studyDescription: "PT/CT Study Demo",
          seriesDescription: "CT Series",
          studyDate: "15/01/2024",
          studyTime: "14:30:25",
          modality: "CT",
        },
        {
          imageId:
            "dicomweb://s3.amazonaws.com/lury/PTCTStudy/1.3.6.1.4.1.25403.52237031786.3872.20100510032220.8.dcm",
          instanceNumber: 2,
          fileName: "demo2.dcm",
          patientName: "Demo Patient",
          studyDescription: "PT/CT Study Demo",
          seriesDescription: "CT Series",
          studyDate: "15/01/2024",
          studyTime: "14:30:25",
          modality: "CT",
        },
        {
          imageId:
            "dicomweb://s3.amazonaws.com/lury/PTCTStudy/1.3.6.1.4.1.25403.52237031786.3872.20100510032220.9.dcm",
          instanceNumber: 3,
          fileName: "demo3.dcm",
          patientName: "Demo Patient",
          studyDescription: "PT/CT Study Demo",
          seriesDescription: "CT Series",
          studyDate: "15/01/2024",
          studyTime: "14:30:25",
          modality: "CT",
        },
      ],
    },
  };

  setTimeout(() => {
    allSeries = sampleData;
    createSeriesUI();
    selectSeries("demo_series_1", 0);
    showSuccess("Demo data loaded successfully");
    showLoading(false);
  }, 1000);
}

// Add demo button
const demoButton = document.createElement("button");
demoButton.className = "upload-btn";
demoButton.innerHTML = '<i class="fas fa-play"></i> Load Demo';
demoButton.onclick = loadSampleData;
demoButton.style.marginTop = "10px";
uploadArea.appendChild(demoButton);

// Initialize cine controls
updateCineControls();

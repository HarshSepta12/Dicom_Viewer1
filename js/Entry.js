// Global variables
let uploadedFolders = [];
let pacsStudies = [];
const PACS_SERVER_URL = "http://localhost:5000/orthanc/";
const DEFAULT_CREDENTIALS = {
  username: "harsh",
  password: "12345",
};

let db = null;

// Initialize IndexedDB
function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("DICOM_DB", 1);

    request.onupgradeneeded = (event) => {
      db = event.target.result;

      if (!db.objectStoreNames.contains("dicomFiles")) {
        db.createObjectStore("dicomFiles", { keyPath: "id", autoIncrement: true });
      }

      if (!db.objectStoreNames.contains("folders")) {
        db.createObjectStore("folders", { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      console.log("IndexedDB initialized");
      resolve(db);
    };

    request.onerror = (event) => {
      console.error("IndexedDB error:", event.target.error);
      reject(event.target.error);
    };
  });
}

// DOM elements
const fileUploadArea = document.getElementById("uploadArea");
const fileInput = document.getElementById("fileInput");
const zipInput = document.getElementById("zipInput");
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");

// Initialize on page load
document.addEventListener("DOMContentLoaded", async function () {
  try {
    await initIndexedDB();
    await loadFoldersFromStorage(); // Load saved folders first
    setupEventListeners();
    checkPACSConnection();
    loadFromPACS();
  } catch (error) {
    console.error("Initialization failed:", error);
  }
});

// Setup event listeners
function setupEventListeners() {
  // Drag and drop events
  fileUploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    fileUploadArea.classList.add("dragover");
  });

  fileUploadArea.addEventListener("dragleave", () => {
    fileUploadArea.classList.remove("dragover");
  });

  fileUploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    fileUploadArea.classList.remove("dragover");
    handleDroppedItems(e.dataTransfer.items);
  });

  // Click to select folder
  fileUploadArea.addEventListener("click", selectFolder);

  // File input changes
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      processFolderUpload(e.target.files);
    }
  });

  zipInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      processZipUpload(e.target.files[0]);
    }
  });
}
async function loadAndStoreCredentials() {
  try {
    const response = await fetch("/api/credentials");
    if (!response.ok) throw new Error("Failed to fetch credentials");
    
    const creds = await response.json();
    localStorage.setItem("pacsCredentials", JSON.stringify(creds));
    
    console.log("Credentials stored in localStorage", creds);
  } catch (error) {
    console.error("Error loading credentials:", error);
  }
}

// Call this once when your app loads
loadAndStoreCredentials();

// Get credentials
function getCredentials() {
  const stored = localStorage.getItem("pacsCredentials");
  return stored ? JSON.parse(stored) : DEFAULT_CREDENTIALS;
}

// Get auth headers
function getAuthHeaders() {
  const credentials = getCredentials();
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
  };
}

// Check PACS connection
async function checkPACSConnection() {
  try {
    const response = await fetch(`${PACS_SERVER_URL}/system`);
    if (response.ok) {
      console.log("PACS server connected");
      return true;
    }
  } catch (error) {
    console.error("PACS connection failed:", error);
  }
  return false;
}

// Load studies from PACS
async function loadFromPACS() {
  showLoading(true, "Loading studies from PACS server...");

  try {
    const headers = getAuthHeaders();
    const response = await fetch(`${PACS_SERVER_URL}/studies`, {
      method: "GET",
      mode: "cors",
      headers: headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const studies = await response.json();
    console.log("Loaded studies from PACS:", studies);

    pacsStudies = [];

    for (let i = 0; i < studies.length; i++) {
      const studyId = studies[i];
      loadingText.textContent = `Processing study ${i + 1}/${studies.length}...`;

      try {
        const studyResponse = await fetch(`${PACS_SERVER_URL}/studies/${studyId}`, {
          method: "GET",
          mode: "cors",
          headers: headers,
        });
        const studyInfo = await studyResponse.json();
        console.log(studyInfo.PatientMainDicomTags);
        
        const instancesResponse = await fetch(`${PACS_SERVER_URL}/studies/${studyId}/instances`, {
          method: "GET",
          mode: "cors",
          headers: headers,
        });
        const instances = await instancesResponse.json();

        const folderData = {
          id: `pacs_${studyId}`,
          name: studyInfo.MainDicomTags?.InstitutionName || `Study ${studyId}`,
          patientName: studyInfo.PatientMainDicomTags?.PatientName || "Unknown Patient",
          patientId: studyInfo.PatientMainDicomTags?.PatientID || "",
          date: studyInfo.MainDicomTags?.StudyDate || new Date().toISOString().split("T")[0],
          studyTime: studyInfo.MainDicomTags?.StudyTime || "",
          modality: studyInfo.MainDicomTags?.ModalitiesInStudy || "DICOM",
          type: "PACS Study",
          fileCount: instances.length,
          studyId: studyId,
          instances: instances,
          source: "pacs",
          accessionNumber: studyInfo.MainDicomTags?.AccessionNumber || "",
          studyInstanceUID: studyInfo.MainDicomTags?.StudyInstanceUID || "",
        };

        pacsStudies.push(folderData);
      } catch (studyError) {
        console.error(`Error processing study ${studyId}:`, studyError);
      }
    }

    // Combine local and PACS studies
    uploadedFolders = [...getLocalFolders(), ...pacsStudies];
    displayFolders(uploadedFolders);
  } catch (error) {
    console.error("Error loading from PACS server:", error);
  } finally {
    showLoading(false);
  }
}

// Get local folders
function getLocalFolders() {
  return uploadedFolders.filter((folder) => folder.source !== "pacs");
}

// Select folder
function selectFolder() {
  fileInput.click();
}

// Handle dropped items
function handleDroppedItems(items) {
  for (let item of items) {
    if (item.kind === "file") {
      const entry = item.webkitGetAsEntry();
      if (entry.isDirectory) {
        processDirectory(entry);
      } else if (entry.name.endsWith(".zip")) {
        processZipUpload(item.getAsFile());
      }
    }
  }
}

// Process folder upload
async function processFolderUpload(files) {
  showLoading(true, "Processing folder...");

  const folderName = files[0].webkitRelativePath.split("/")[0];
  const folderId = Date.now();
  const dicomFilesMeta = [];

  const validFiles = Array.from(files).filter((file) => {
    const name = file.name.toLowerCase();
    return (
      (name.endsWith(".dcm") ||
        name.includes("dicom") ||
        file.type === "application/dicom" ||
        file.type === "") &&
      name !== "dicomdir"
    );
  });

  for (let i = 0; i < validFiles.length; i++) {
    const file = validFiles[i];
    try {
      await saveFileToIndexedDB(folderId, file);

      dicomFilesMeta.push({
        name: file.name,
        path: file.webkitRelativePath || file.name,
        size: file.size,
        type: file.type || "application/dicom",
        storedInDB: true
      });

      const progress = ((i + 1) / validFiles.length) * 100;
      updateProgress(progress);
      loadingText.textContent = `Processing files... (${i + 1}/${validFiles.length})`;

    } catch (error) {
      console.error('Error saving file:', file.name, error);
    }
  }

  if (dicomFilesMeta.length > 0) {
    const folderData = {
      id: folderId,
      name: folderName,
      patientName: extractPatientName(folderName),
      date: new Date().toISOString().split("T")[0],
      type: "Local DICOM Folder",
      fileCount: dicomFilesMeta.length,
      files: dicomFilesMeta,
      folderPath: folderName,
      source: "local",
    };

    // Add to local folders array
    const localFolders = getLocalFolders();
    localFolders.push(folderData);
    uploadedFolders = [...localFolders, ...pacsStudies];

    // Save to storage
    await saveFolderToIndexedDB(folderData);
    saveFoldersToLocalStorage();
    displayFolders(uploadedFolders);
    
    showLoading(false);
    updateProgress(0);
    alert(`${folderName} uploaded successfully! (${dicomFilesMeta.length} DICOM files found)`);
  } else {
    showLoading(false);
    updateProgress(0);
    alert("No valid DICOM files could be processed!");
  }
}

// Process ZIP upload
function processZipUpload(zipFile) {
  showLoading(true, "Processing ZIP file...");

  const folderData = {
    id: Date.now(),
    name: zipFile.name.replace(".zip", ""),
    patientName: extractPatientName(zipFile.name),
    date: new Date().toISOString().split("T")[0],
    type: "Local ZIP Archive",
    fileCount: 0,
    files: [],
    zipFile: zipFile,
    source: "local",
  };

  const localFolders = getLocalFolders();
  localFolders.push(folderData);
  uploadedFolders = [...localFolders, ...pacsStudies];

  saveFolderToIndexedDB(folderData);
  saveFoldersToLocalStorage();
  displayFolders(uploadedFolders);

  showLoading(false);
  alert(`${zipFile.name} ZIP file uploaded successfully!`);
}

// Process directory from drag & drop
async function processDirectory(directoryEntry) {
  showLoading(true, "Reading directory...");

  const files = [];
  const folderId = Date.now();

  async function readDirectoryRecursive(entry) {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file(async (file) => {
          if (
            file.name.toLowerCase().endsWith(".dcm") ||
            file.name.toLowerCase().includes("dicom")
          ) {
            try {
              await saveFileToIndexedDB(folderId, file);
              files.push({
                name: file.name,
                path: entry.fullPath,
                size: file.size,
                type: file.type || "application/dicom",
                storedInDB: true,
              });
            } catch (error) {
              console.error("Error processing file:", file.name, error);
            }
          }
          resolve();
        });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        dirReader.readEntries(async (entries) => {
          const promises = entries.map(readDirectoryRecursive);
          await Promise.all(promises);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  await readDirectoryRecursive(directoryEntry);

  if (files.length > 0) {
    const folderData = {
      id: folderId,
      name: directoryEntry.name,
      patientName: extractPatientName(directoryEntry.name),
      date: new Date().toISOString().split("T")[0],
      type: "Local DICOM Folder",
      fileCount: files.length,
      files: files,
      folderPath: directoryEntry.fullPath,
      source: "local",
    };

    const localFolders = getLocalFolders();
    localFolders.push(folderData);
    uploadedFolders = [...localFolders, ...pacsStudies];

    await saveFolderToIndexedDB(folderData);
    saveFoldersToLocalStorage();
    displayFolders(uploadedFolders);
    
    showLoading(false);
    alert(`${directoryEntry.name} folder processed successfully! (${files.length} DICOM files)`);
  } else {
    showLoading(false);
    alert("No DICOM files found in dropped folder!");
  }
}

// Extract patient name
function extractPatientName(folderName) {
  const name = folderName
    .replace(/[_-]/g, " ")
    .replace(/\d+/g, "")
    .replace(/\.(zip|dcm)$/i, "")
    .trim();
  return name || "Unknown Patient";
}

// Save file to IndexedDB
function saveFileToIndexedDB(folderId, file) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized!"));
      return;
    }

    const transaction = db.transaction("dicomFiles", "readwrite");
    const store = transaction.objectStore("dicomFiles");

    const record = {
      folderId: folderId,
      name: file.name,
      path: file.webkitRelativePath || file.name,
      size: file.size,
      type: file.type || "application/dicom",
      data: file
    };

    const request = store.add(record);
    request.onsuccess = () => resolve(true);
    request.onerror = (e) => reject(e.target.error);
  });
}

// Save folder to IndexedDB
function saveFolderToIndexedDB(folderData) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized!"));
      return;
    }

    const transaction = db.transaction("folders", "readwrite");
    const store = transaction.objectStore("folders");

    const request = store.put(folderData);
    request.onsuccess = () => resolve(true);
    request.onerror = (e) => reject(e.target.error);
  });
}

// Load folders from IndexedDB
function loadFoldersFromIndexedDB() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized!"));
      return;
    }

    const transaction = db.transaction("folders", "readonly");
    const store = transaction.objectStore("folders");
    const folders = [];

    store.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        folders.push(cursor.value);
        cursor.continue();
      } else {
        resolve(folders);
      }
    };

    store.openCursor().onerror = (e) => reject(e.target.error);
  });
}

// Save folders metadata to localStorage (backup)
function saveFoldersToLocalStorage() {
  try {
    const localFolders = getLocalFolders();
    const foldersMeta = localFolders.map((folder) => ({
      ...folder,
      files: folder.files ? folder.files.map((f) => ({
        name: f.name,
        path: f.path,
        size: f.size,
        type: f.type,
        storedInDB: true,
      })) : []
    }));

    localStorage.setItem("dicomFolders", JSON.stringify(foldersMeta));
    console.log("Saved folder metadata to localStorage");
  } catch (error) {
    console.error("Error saving folders to localStorage:", error);
  }
}

// Load folders from storage (IndexedDB + localStorage backup)
async function loadFoldersFromStorage() {
  try {
    // Try loading from IndexedDB first
    const foldersFromDB = await loadFoldersFromIndexedDB();
    console.log("Loaded folders from IndexedDB:", foldersFromDB.length);
    
    if (foldersFromDB.length > 0) {
      uploadedFolders = foldersFromDB;
    } else {
      // Fallback to localStorage
      const stored = localStorage.getItem("dicomFolders");
      if (stored) {
        const parsedFolders = JSON.parse(stored);
        uploadedFolders = parsedFolders;
        console.log("Loaded folders from localStorage:", parsedFolders.length);
      }
    }
    
    // Display loaded folders
    displayFolders(uploadedFolders);
  } catch (error) {
    console.error("Error loading folders from storage:", error);
    // Try localStorage as fallback
    try {
      const stored = localStorage.getItem("dicomFolders");
      if (stored) {
        uploadedFolders = JSON.parse(stored);
        displayFolders(uploadedFolders);
      }
    } catch (localStorageError) {
      console.error("Error loading from localStorage:", localStorageError);
    }
  }
}

// Load files from IndexedDB for specific folder
async function loadFilesFromIndexedDB(folderId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized!"));
      return;
    }

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

    store.openCursor().onerror = (e) => reject(e.target.error);
  });
}

// Filter folders
function filterFolders() {
  const searchTerm = document.getElementById("patientSearch")?.value.toLowerCase() || "";
  const fromDate = document.getElementById("fromDate")?.value || "";
  const toDate = document.getElementById("toDate")?.value || "";
  const sourceFilter = document.getElementById("sourceFilter")?.value || "all";

  let filtered = uploadedFolders.filter((folder) => {
    const matchesSearch = folder.patientName.toLowerCase().includes(searchTerm);
    const folderDate = folder.date || "";
    const matchesDateRange =
      (!fromDate || folderDate >= fromDate) &&
      (!toDate || folderDate <= toDate);
    const matchesSource = sourceFilter === "all" || folder.source === sourceFilter;

    return matchesSearch && matchesDateRange && matchesSource;
  });

  displayFolders(filtered);
}

// Format date
function formatDate(dateStr) {
  if (!dateStr) return "Unknown";
  if (dateStr.length === 8) {
    return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
  }
  return dateStr;
}

// Format time
function formatTime(timeStr) {
  if (!timeStr || timeStr.length < 6) return "";
  return `${timeStr.substring(0, 2)}:${timeStr.substring(2, 4)}:${timeStr.substring(4, 6)}`;
}

// Display folders
function displayFolders(folders) {
  const folderGrid = document.getElementById("folderGrid");
  if (!folderGrid) return;

  if (folders.length === 0) {
    folderGrid.innerHTML = `
      <div class="no-folders">
        No folders found<br>
        <small>Upload a folder or refresh from PACS</small>
      </div>
    `;
    return;
  }

  folderGrid.innerHTML = folders
    .map((folder) => {
      const isPACS = folder.source === "pacs";
      const folderIcon = isPACS ? "🏥" : "📁";
      const sourceLabel = isPACS ? "PACS Server" : "Local Upload";

      return `
        <div class="folder-card" onclick="openDicomViewer('${folder.id}')">
          <div class="folder-icon">${folderIcon}</div>
          <div class="folder-name">${folder.name}</div>
          <div class="folder-details">
            <div><strong>Patient:</strong> ${folder.patientName}</div>
            ${folder.patientId ? `<div><strong>Patient ID:</strong> ${folder.patientId}</div>` : ""}
            <div><strong>Date:</strong> ${formatDate(folder.date)} ${formatTime(folder.studyTime || "")}</div>
            <div><strong>Type:</strong> ${folder.type}</div>
            <div><strong>Modality:</strong> ${folder.modality || "DICOM"}</div>
            <div><strong>Instances:</strong> <span class="instance-count">${folder.fileCount}</span></div>
            <div style="font-size: 0.8em; color: #007bff;"><strong>Source:</strong> ${sourceLabel}</div>
            ${folder.accessionNumber ? `<div class="study-info"><strong>Acc#:</strong> ${folder.accessionNumber}</div>` : ""}
          </div>
        </div>
      `;
    })
    .join("");
}

// Open DICOM viewer
function openDicomViewer(folderId) {
  const folder = uploadedFolders.find((f) => f.id == folderId);
  if (!folder) {
    alert("Folder not found!");
    return;
  }

  console.log("Opening viewer for folder:", folder);

  sessionStorage.setItem("selectedFolderId", folderId);
debugger;
  if (folder.source === "pacs") {
    sessionStorage.setItem("pacsStudyId", folder.studyId);
    sessionStorage.setItem("pacsServerUrl", PACS_SERVER_URL);
    sessionStorage.setItem("dataSource", "pacs");
    sessionStorage.setItem("pacsUsername", getCredentials().username);
    sessionStorage.setItem("pacsPassword", getCredentials().password);
  } else {
    sessionStorage.setItem("dataSource", "local");
  }

  sessionStorage.setItem("hasDicomData", "true");
  window.location.href = `viewer.html?id=${folderId}`;
}

// Show/hide loading
function showLoading(show, message = "Loading...") {
  if (loadingOverlay) {
    loadingOverlay.style.display = show ? "flex" : "none";
    if (loadingText && message) {
      loadingText.textContent = message;
    }
  }
}

// Update progress
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

// Clear all local folders
async function clearAllFolders() {
  if (confirm("Are you sure you want to clear all locally uploaded folders?")) {
    try {
      // Clear IndexedDB
      if (db) {
        const transaction = db.transaction(["folders", "dicomFiles"], "readwrite");
        await transaction.objectStore("folders").clear();
        await transaction.objectStore("dicomFiles").clear();
      }
      
      // Clear localStorage
      localStorage.removeItem("dicomFolders");
      sessionStorage.removeItem("selectedFolderId");
      sessionStorage.removeItem("hasDicomData");
      
      // Reset arrays
      uploadedFolders = [...pacsStudies];
      displayFolders(uploadedFolders);
      
      alert("All local folders cleared!");
    } catch (error) {
      console.error("Error clearing folders:", error);
      alert("Error clearing folders!");
    }
  }
}

// Export functions for global access
window.selectFolder = selectFolder;
window.filterFolders = filterFolders;
window.openDicomViewer = openDicomViewer;
window.clearAllFolders = clearAllFolders;
window.checkPACSConnection = checkPACSConnection;
window.loadFilesFromIndexedDB = loadFilesFromIndexedDB;
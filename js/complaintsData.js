// Fetches and displays complaints / investigation locations from a published Google Sheet CSV.

const COMPLAINTS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vR_FSgVpGsiBFfky2PsQtQkkv2rQYq5ElDEELxGw0CqrNQ27LmqSAXXzGQe1-8B_NdTVMhIrgo7jENd/pub?output=csv";

let complaintsMarkers = null;
let complaintsHeatLayer = null;
let complaintsCurrentView = "none";
let complaintSearchMarker = null;

window.allComplaintsData = [];

function escapeComplaintHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadComplaintsData() {
  const separator = COMPLAINTS_CSV_URL.includes("?") ? "&" : "?";
  const urlWithBust = `${COMPLAINTS_CSV_URL}${separator}t=${Date.now()}`;

  return fetch(urlWithBust, { cache: "no-store" })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Complaints CSV request failed: ${response.status}`);
      }
      return response.text();
    })
    .then(csvText => {
      const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: header => header.trim()
      });

      if (parsed.errors.length) {
        console.warn("Complaints CSV parsing warnings:", parsed.errors);
      }

      window.allComplaintsData = parsed.data.map(row => {
        const easting = parseFloat(String(row["EASTING"] ?? "").replaceAll(",", ""));
        const northing = parseFloat(String(row["NORTHING"] ?? "").replaceAll(",", ""));

        return {
          ...row,
          EASTING: Number.isFinite(easting) ? easting : null,
          NORTHING: Number.isFinite(northing) ? northing : null
        };
      });

      renderComplaintsData();

      const group = document.getElementById("complaintsDataViewGroup");
      if (group) group.classList.remove("disabled");

      const input = document.getElementById("complaintFileInput");
      const searchBtn = document.getElementById("complaintSearchBtn");
      const clearBtn = document.getElementById("complaintClearBtn");
      if (input) input.disabled = false;
      if (searchBtn) searchBtn.disabled = false;
      if (clearBtn) clearBtn.disabled = false;
    })
    .catch(error => {
      console.error("Error loading complaints data:", error);
      const group = document.getElementById("complaintsDataViewGroup");
      if (group) group.classList.add("disabled");
    });
}

function countMappableComplaints() {
  return window.allComplaintsData.filter(item =>
    Number.isFinite(item.EASTING) && Number.isFinite(item.NORTHING)
  ).length;
}

function getComplaintPopupContent(item) {
  return `
    <div class="popup-field"><strong>Complaint File:</strong> ${escapeComplaintHtml(item["COMPLAINT FILE NUMBER"] || "N/A")}</div>
    <div class="popup-field"><strong>Date Created:</strong> ${escapeComplaintHtml(item["DATE TICKET WAS CREATED"] || "N/A")}</div>
    <div class="popup-field"><strong>Nature:</strong> ${escapeComplaintHtml(item["NATURE OF COMPLAINT"] || "N/A")}</div>
    <div class="popup-field"><strong>Location:</strong> ${escapeComplaintHtml(item["LOCATION"] || "N/A")}</div>
    <div class="popup-field"><strong>Easting:</strong> ${escapeComplaintHtml(item.EASTING)}</div>
    <div class="popup-field"><strong>Northing:</strong> ${escapeComplaintHtml(item.NORTHING)}</div>
    <div class="popup-field"><strong>Status:</strong> ${escapeComplaintHtml(item["STATUS"] || "N/A")}</div>
    <div class="popup-field"><strong>Comments:</strong> ${escapeComplaintHtml(item["COMMENTS"] || "N/A")}</div>
  `;
}

function renderComplaintsData() {
  if (complaintsMarkers && map.hasLayer(complaintsMarkers)) {
    map.removeLayer(complaintsMarkers);
  }
  if (complaintsHeatLayer && map.hasLayer(complaintsHeatLayer)) {
    map.removeLayer(complaintsHeatLayer);
  }

  complaintsMarkers = L.markerClusterGroup({
    showCoverageOnHover: false,
    iconCreateFunction(cluster) {
      const count = cluster.getChildCount();
      let sizeClass = "complaints-cluster-small";
      if (count > 50) sizeClass = "complaints-cluster-large";
      else if (count > 20) sizeClass = "complaints-cluster-medium";

      return L.divIcon({
        html: `<div><span>${count}</span></div>`,
        className: `complaints-cluster ${sizeClass}`,
        iconSize: L.point(42, 42)
      });
    }
  });

  const heatPoints = [];

  window.allComplaintsData.forEach(item => {
    if (!Number.isFinite(item.EASTING) || !Number.isFinite(item.NORTHING)) return;

    let lat;
    let lon;
    try {
      [lat, lon] = convertUTMToLatLon(item.EASTING, item.NORTHING);
    } catch (error) {
      console.warn("Complaint coordinate conversion failed:", item, error);
      return;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const marker = L.circleMarker([lat, lon], {
      radius: 7,
      color: "#8a3ffc",
      weight: 2,
      fillColor: "#b388ff",
      fillOpacity: 0.9
    }).bindPopup(getComplaintPopupContent(item));

    complaintsMarkers.addLayer(marker);
    heatPoints.push([lat, lon, 0.7]);
  });

  complaintsHeatLayer = L.heatLayer(heatPoints, {
    radius: 20,
    blur: 15,
    maxZoom: 17,
    gradient: {
      0.2: "#e0aaff",
      0.5: "#9d4edd",
      0.8: "#7b2cbf",
      1.0: "#3c096c"
    }
  });

  if (complaintsCurrentView === "cluster") {
    map.addLayer(complaintsMarkers);
  } else if (complaintsCurrentView === "heatmap") {
    map.addLayer(complaintsHeatLayer);
  }
}

function switchComplaintsView(mode) {
  if (!['cluster', 'heatmap', 'none'].includes(mode)) return;

  if (complaintsMarkers && map.hasLayer(complaintsMarkers)) {
    map.removeLayer(complaintsMarkers);
  }
  if (complaintsHeatLayer && map.hasLayer(complaintsHeatLayer)) {
    map.removeLayer(complaintsHeatLayer);
  }

  complaintsCurrentView = mode;
  renderComplaintsData();
}

function setupComplaintsControl() {
  const input = document.getElementById("complaintFileInput");
  const searchBtn = document.getElementById("complaintSearchBtn");
  const clearBtn = document.getElementById("complaintClearBtn");

  if (!input || !searchBtn || !clearBtn) return;

  input.disabled = true;
  searchBtn.disabled = true;
  clearBtn.disabled = true;

  function clearComplaintSearch() {
    input.value = "";
    if (complaintSearchMarker && map.hasLayer(complaintSearchMarker)) {
      map.removeLayer(complaintSearchMarker);
    }
    complaintSearchMarker = null;
  }

  function performComplaintSearch() {
    const query = input.value.trim();
    if (!query) return;

    const normalizedQuery = query.toUpperCase();
    const match = window.allComplaintsData.find(item =>
      String(item["COMPLAINT FILE NUMBER"] ?? "").trim().toUpperCase() === normalizedQuery
    );

    if (!match) {
      alert("No exact matching Complaint File Number was found.");
      return;
    }

    if (!Number.isFinite(match.EASTING) || !Number.isFinite(match.NORTHING)) {
      alert("The matching complaint does not have valid Easting and Northing coordinates.");
      return;
    }

    let lat;
    let lon;
    try {
      [lat, lon] = convertUTMToLatLon(match.EASTING, match.NORTHING);
    } catch (error) {
      console.error("Complaint search coordinate conversion failed:", error);
      alert("The matching complaint coordinates could not be converted.");
      return;
    }

    if (complaintSearchMarker && map.hasLayer(complaintSearchMarker)) {
      map.removeLayer(complaintSearchMarker);
    }

    complaintSearchMarker = L.circleMarker([lat, lon], {
      radius: 10,
      color: "#5a189a",
      fillColor: "#e0aaff",
      fillOpacity: 0.95,
      weight: 3
    })
      .addTo(map)
      .bindPopup(getComplaintPopupContent(match))
      .openPopup();

    map.setView([lat, lon], 16);
  }

  searchBtn.addEventListener("click", performComplaintSearch);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") performComplaintSearch();
  });
  clearBtn.addEventListener("click", clearComplaintSearch);
}

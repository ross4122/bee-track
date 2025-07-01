// Initialize the map
const map = L.map("map").setView([53.4808, -2.2426], 14); // Set initial view to a known coordinate

// Set up the map tiles (this example uses OpenStreetMap)
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

// Add the "Locate Me" button control
L.control
    .locate({
        position: "topleft", // Controls the position (like the zoom buttons)
        follow: true, // Center map on the user's location when it changes
        setView: true, // Automatically zooms in when the location is found
        keepCurrentZoomLevel: true, // Don't zoom out when moving to the location
        icon: "fa fa-location-arrow", // Icon for the locate button
        iconLoading: "fa fa-spinner fa-spin", // Icon when locating
        showPopup: false, // Optional: display popup with the location
    })
    .addTo(map);

// Request user's location and add a blue circle marker
function addUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userCoords = [
                    position.coords.latitude,
                    position.coords.longitude,
                ];

                // Add a blue circle marker for the user
                L.circleMarker(userCoords, {
                    color: "blue", // Border color
                    fillColor: "blue", // Fill color
                    fillOpacity: 0.5,
                    radius: 5, // Adjust size of the circle
                }).addTo(map);

                // Center the map on the user's location
                map.setView(userCoords, 14);
            },
            (error) => {
                console.error("Error getting user location:", error.message);
            }
        );
    } else {
        console.error("Geolocation is not supported by this browser.");
    }
}

// Call function to request location
addUserLocation();

// Function to calculate seconds ago since data was received
function secondsAgo(timestamp) {
    const now = new Date();
    const dataTime = new Date(timestamp);

    // Check if the timestamp is valid
    if (isNaN(dataTime)) {
        return "Invalid timestamp"; // Handle invalid timestamps
    }

    const diff = now - dataTime; // Time difference in milliseconds
    return Math.floor(diff / 1000); // Convert milliseconds to seconds
}

// Function to create custom rectangle icons with fleet numbers
function createVehicleIcon(line, vehicleRef) {
    const html = `
    <div style="display: flex; justify-content: center; align-items: center; height: 100%; width: 100%;">${line}</div>
  `;

    let iconClass = "newicon";

    if (rReqIconFleetNumbers.has(vehicleRef)) {
        iconClass = "r-reqicon";
    } else if (kReqIconFleetNumbers.has(vehicleRef)) {
        iconClass = "k-reqicon";
    } else if (bothReqIconFleetNumbers.has(vehicleRef)) {
        iconClass = "bothreqicon";
    }

    return L.divIcon({
        iconSize: [32, 13],
        html: html,
        className: iconClass,
        popupAnchor: [0, -5],
    });
}

/// Function to get fleet number (removes depot code if present)
function getFleetNumber(fleetNumber) {
    const parts = fleetNumber.split(" "); // Split on space
    return parts[parts.length - 1]; // Return the last part (fleet number)
}

function getVehicleType(fleetNumber) {
    const num = parseInt(fleetNumber, 10);
    if (num >= 10001 && num <= 10198) return "ADL E400";
    if (num >= 10301 && num <= 11880) return "ADL E400MMC";
    if (num >= 11881 && num <= 11930) return "ADL E400City";
    if (num >= 12001 && num <= 12364) return "ADL E400H";
    if (num >= 13161 && num <= 13193) return "Volvo B5LH G2";
    if (num >= 17001 && num <= 18539) return "Volvo B5LH G2";
    if (num >= 18901 && num <= 18930) return "StreetDeck HEV";
    if (num >= 19001 && num <= 19916) return "ADL E400";
    if (num >= 21351 && num <= 21440) return "B8RLE Evora";
    if (num >= 26001 && num <= 26359) return "ADL E200MMC";
    if (num >= 27101 && num <= 27959) return "ADL E300";
    if (num >= 36011 && num <= 37327) return "ADL E200";
    if (num >= 37328 && num <= 37633) return "ADL E200MMC";
    if (num >= 44901 && num <= 44904) return "Mellor Strata";
    if (num >= 46021 && num <= 46024) return "ADL E100EV";
    if (num >= 48104 && num <= 48114) return "Optare Solo SR";
    if (num >= 66071 && num <= 66082) return "BZL Midi";
    if (num >= 76101 && num <= 76104) return "BZL SD";
    if (num >= 80087 && num <= 80121) return "ADL E400EV";
    if (num >= 84201 && num <= 84250) return "BYD E400EV";
    if (num >= 86031 && num <= 86069) return "BZL DD";
    return "Unknown";
}

const vehicleMarkers = new Map();
let lastOpenedFleetNumber = null; // Store last opened popup's fleet number
let popupWasOpen = false; // Track if a popup was open before refresh

// Function to fetch and display vehicle locations
async function fetchVehicleData() {
    try {
        const feedUrls = [
            "https://data.bus-data.dft.gov.uk/api/v1/datafeed/14336/?api_key=fce46df3b5be69bb9ffc0b1d857697af13f95a92",
            "https://data.bus-data.dft.gov.uk/api/v1/datafeed/16387/?api_key=fce46df3b5be69bb9ffc0b1d857697af13f95a92"
        ];

        // Use CORS proxy for both
        const proxiedUrls = feedUrls.map(url => `https://corsproxy.io/?${encodeURIComponent(url)}`);

        // Fetch both APIs in parallel
        const responses = await Promise.all(proxiedUrls.map(url => fetch(url)));
        const xmlTexts = await Promise.all(responses.map(res => {
            if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
            return res.text();
        }));

        // Parse XML from both feeds
        const parser = new DOMParser();
        const allVehicleActivities = [];

        for (const xmlText of xmlTexts) {
            const xml = parser.parseFromString(xmlText, "application/xml");
            const activities = Array.from(xml.getElementsByTagName("VehicleActivity"));
            allVehicleActivities.push(...activities);
        }

        const showRequirementsOnly = document.getElementById("requirementsCheckbox").checked;

        // Cleanup non-required markers if filtering
        if (showRequirementsOnly) {
            vehicleMarkers.forEach((marker, vehicleRef) => {
                if (
                    !rReqIconFleetNumbers.has(vehicleRef) &&
                    !kReqIconFleetNumbers.has(vehicleRef) &&
                    !bothReqIconFleetNumbers.has(vehicleRef)
                ) {
                    marker.remove();
                    vehicleMarkers.delete(vehicleRef);
                }
            });
        }

        popupWasOpen = !!map._popup;

        allVehicleActivities.forEach((activity) => {
            const line = activity.querySelector("PublishedLineName")?.textContent || "";
            let vehicleRef = activity.querySelector("VehicleRef")?.textContent || "";
			vehicleRef = vehicleRef.replace(/_/g, ""); // Remove underscores
            const recordedAtTimeStr = activity.querySelector("RecordedAtTime")?.textContent || "";
            const destination = (activity.querySelector("DestinationName")?.textContent || "").replace(/_/g, " ");

            const lat = parseFloat(activity.querySelector("VehicleLocation > Latitude")?.textContent);
            const lon = parseFloat(activity.querySelector("VehicleLocation > Longitude")?.textContent);

            if (!lat || !lon) return;

            let fleet_number = vehicleRef;
            let vehicleType = getVehicleType(fleet_number); // Default to Stagecoach logic

            if (metrolineLookup.hasOwnProperty(vehicleRef)) {
                fleet_number = metrolineLookup[vehicleRef].fleetNumber;
                vehicleType = metrolineLookup[vehicleRef].type;
            }
            const recordedAt = new Date(recordedAtTimeStr);
            const now = new Date();
            const timeSinceLastFix = Math.floor((now - recordedAt) / 1000);

            if (timeSinceLastFix > 900) return;

            if (
                showRequirementsOnly &&
                !(
                    rReqIconFleetNumbers.has(fleet_number) ||
                    kReqIconFleetNumbers.has(fleet_number) ||
                    bothReqIconFleetNumbers.has(fleet_number)
                )
            ) return;

            let timeAgo = timeSinceLastFix < 60 ?
                `${timeSinceLastFix} seconds ago` :
                timeSinceLastFix < 120 ?
                "1 minute ago" :
                `${Math.floor(timeSinceLastFix / 60)} minutes ago`;

            let popupText = line && destination ?
                `<b>${line}</b> to <b>${destination}</b>` :
                line ?
                `<b>${line}</b>` :
                "Not in Service";

            if (vehicleMarkers.has(vehicleRef)) {
                vehicleMarkers.get(vehicleRef).setLatLng([lat, lon]);
            } else {
                const marker = L.marker([lat, lon], {
                    icon: createVehicleIcon(line, vehicleRef),
                }).addTo(map);

                marker.bindPopup(`
    <b>${popupText}</b><br>
    <b>${fleet_number}</b> – ${vehicleType}<br>
    <small>${timeAgo}</small>
  `);

                vehicleMarkers.set(vehicleRef, marker);

                marker.on("popupopen", () => {
                    lastOpenedFleetNumber = vehicleRef;
                    popupWasOpen = true;
                });

                marker.on("popupclose", () => {
                    lastOpenedFleetNumber = null;
                    popupWasOpen = false;
                });
            }
        });

        if (
            popupWasOpen &&
            lastOpenedFleetNumber &&
            vehicleMarkers.has(lastOpenedFleetNumber)
        ) {
            vehicleMarkers.get(lastOpenedFleetNumber).openPopup();
        }
    } catch (error) {
        console.error("Error fetching vehicle data:", error);
    }
}

document
    .getElementById("requirementsCheckbox")
    .addEventListener("change", fetchVehicleData);

// Initial fetch of vehicle locations
fetchVehicleData();

// Poll for updates every 10 seconds
setInterval(fetchVehicleData, 10000);

let fetchTimeout;

// Fetch data after the user stops moving the map for 1 second
map.on("moveend", () => {
    clearTimeout(fetchTimeout);
    fetchTimeout = setTimeout(fetchVehicleData, 1000);
});
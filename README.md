# Swim Timer

A web app for swim team timing using a phone camera to detect when a swimmer crosses the wall plane at the end of a lane.

## How it works

The camera sits at the **start/finish wall**, looking horizontally across the lane. When a swimmer's arm or body breaks the detection plane on a turn, the timer counts laps:

- Each wall touch at the camera end = **2 laps** (swimmer went out and back)
- **100 yards** in a 25-yard pool = 4 laps = **2 detections** (first turn = 2 laps, second = finish)
- **50 yards** = 2 laps = **1 detection**

## Setup

```bash
npm install
npm run dev
```

This starts:
- **Coach dashboard** at `https://localhost:5173` (HTTPS required for camera access)
- **Socket server** at `http://localhost:3001`

### Phone + laptop on the same Wi‑Fi

1. Find your laptop's local IP: `ipconfig getifaddr en0` (Mac) or `hostname -I` (Linux)
2. On the phone, open `https://<laptop-ip>:5173?mode=camera`
3. Accept the self-signed certificate warning (required for camera access)
4. On the laptop, open `https://localhost:5173` for the coach dashboard

Both devices stay in sync over WebSockets.

## Usage

### Coach (laptop)
1. Enter swimmer name and select distance (25, 50, 100, 200, or 500 yd)
2. Click **Arm Timer**
3. Click **Start Race** when the swimmer dives in
4. Watch elapsed time and lap count update automatically

### Camera (phone)
1. Mount the phone at the end of the lane, facing the wall plane
2. Switch to **Camera** mode (or use `?mode=camera` URL)
3. Adjust the **detection line** to align with where the swimmer crosses
4. Tap **Calibrate** with an empty lane to reduce false triggers
5. Detection runs automatically while the race is in progress

## Detection tips

- Use the **rear camera** for best quality
- Calibrate with no swimmers in the detection zone
- Increase **sensitivity** if turns are missed; decrease if you get false triggers
- The blue/green line shows the virtual wall plane; green flash means motion exceeded threshold

## Production build

```bash
npm run build
npm start
```

Serves the app and WebSocket server on port 3001.

# homebridge-lyrion-control

A [Homebridge](https://homebridge.io) platform plugin for [Lyrion Media Server](https://lyrion.org) (LMS), formerly known as Logitech Media Server / Squeezebox.

Automatically discovers all LMS players on your network and exposes them to Apple HomeKit, enabling control via Siri and HomeKit automations.

---

## Features

- **Auto-discovery** — finds all LMS players automatically, no manual configuration per player
- **Play / Stop** — via a Fan accessory (on = play, off = stop)
- **Volume control** — fan speed maps directly to volume (0–100)
- **Real-time status** — polls LMS every 5 seconds to keep HomeKit in sync
- **Siri compatible** — "Hey Siri, turn on Kitchen Radio", "set Kitchen Radio to 50%"
- **Automation compatible** — works as a trigger and action in HomeKit automations
- **Supports Squeezelite / piCorePlayer** — not just hardware Squeezebox players
- **Homebridge v2 ready** — built for Homebridge v2 with strict plugin resolution

---

## How It Appears in HomeKit

Each LMS player appears as a **Fan accessory**:

| Control | Action |
|---|---|
| Fan on | Start playback |
| Fan off | Stop playback |
| Fan speed (0–100) | Volume |

---

## Requirements

- [Homebridge](https://homebridge.io) v2.0.0 or later
- Node.js v18 or later
- Lyrion Media Server (LMS) accessible on your local network
- LMS players (Squeezelite, piCorePlayer, hardware Squeezebox, etc.)

---

## Installation

### Via Homebridge UI (recommended)

1. Open the Homebridge UI
2. Go to **Plugins** and search for `homebridge-lyrion-control`
3. Click **Install**
4. Configure via the plugin settings (see below)
5. Restart Homebridge

### Manual installation

```bash
sudo npm install -g homebridge-lyrion-control
```

---

## Configuration

Configure via the Homebridge UI plugin settings, or add the following to your `config.json`:

```json
{
  "platforms": [
    {
      "platform": "LMSPlatform",
      "name": "Lyrion Media Server",
      "serverurl": "http://YOUR-LMS-IP:9000",
      "updateInterval": 5,
      "debug": false
    }
  ]
}
```

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `serverurl` | string | *required* | Full URL to your LMS server including port (default port: 9000) |
| `updateInterval` | integer | `5` | How often (in seconds) to poll player status. Range: 1–60 |
| `debug` | boolean | `false` | Enable verbose debug logging for troubleshooting |

---

## Siri Commands

Once added to HomeKit, you can control your players with Siri:

| Command | Action |
|---|---|
| "Hey Siri, turn on Kitchen Radio" | Start playback |
| "Hey Siri, turn off Kitchen Radio" | Stop playback |
| "Hey Siri, set Kitchen Radio to 50%" | Set volume to 50 |

---

## HomeKit Automations

Players can be used in automations as both triggers and actions. For example:

- **When I arrive home** → Turn on Living Room Speaker
- **When I leave home** → Turn off all speakers
- **At 7:00 AM** → Turn on Kitchen Radio, set to 30%
- **When good night scene activates** → Turn off all speakers

---

## Troubleshooting

### No players found
- Confirm LMS is running and reachable: `curl http://<your-lms-ip>:9000/jsonrpc.js -X POST -H "Content-Type: application/json" -d '{"id":1,"method":"slim.request","params":["",["players",0,99]]}'`
- Check the `serverurl` in your config includes `http://` and the correct port

### Players appear but don't respond
- Enable `debug: true` in config and check Homebridge logs
- Confirm the player is connected in the LMS web interface

### Volume shows as negative
- This can happen when a player is muted at the LMS level. The plugin clamps volume to 0 in this case.

---

## Compatibility

| LMS Player Type | Supported |
|---|---|
| Squeezelite | ✅ |
| piCorePlayer | ✅ |
| Hardware Squeezebox | ✅ |
| Squeezebox Radio | ✅ |
| Squeezebox Touch | ✅ |

---

## Contributing

Issues and pull requests welcome at [github.com/nilthing9/homebridge-lyrion-control](https://github.com/nilthing9/homebridge-lyrion-control).

---

## License

MIT © nilthing9

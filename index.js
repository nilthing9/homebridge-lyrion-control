/**
 * homebridge-lyrion-control
 * Homebridge platform plugin for Lyrion Media Server (LMS) / Squeezebox
 *
 * Each LMS player is exposed as:
 *   - Fanv2 service  → Active = play/stop,  RotationSpeed = volume 0–100
 *   - SmartSpeaker   → CurrentMediaState / TargetMediaState (play/pause/stop)
 *
 * Both services stay in sync. Fan is what Siri and automations act on primarily.
 * SmartSpeaker adds explicit Pause support that a fan switch cannot express.
 *
 * NOTE: HAP v2+ removed named constants on CurrentMediaState / TargetMediaState.
 * We use raw numeric values per the HAP spec directly.
 *   CurrentMediaState: PLAYING=0, PAUSED=1, STOPPED=2, LOADING=3, INTERRUPTION=4
 *   TargetMediaState:  PLAY=0,    PAUSE=1,  STOP=2
 */

"use strict";

const axios = require("axios");

// HAP media state constants (safe across all HAP versions)
const CurrentMediaState = { PLAYING: 0, PAUSED: 1, STOPPED: 2, LOADING: 3, INTERRUPTION: 4 };
const TargetMediaState  = { PLAY: 0, PAUSE: 1, STOP: 2 };

let Service, Characteristic, Categories;

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  Categories = api.hap.Categories;
  api.registerPlatform("homebridge-lyrion-control", "LMSPlatform", LMSPlatform);
};

// ─────────────────────────────────────────────────────────────────
// PLATFORM
// ─────────────────────────────────────────────────────────────────

class LMSPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = [];

    if (!config || !config.serverurl) {
      this.log.error("LMSPlatform: 'serverurl' is required – plugin will not start.");
      this.log.error("Configure the plugin via the Homebridge UI or add serverurl to config.json.");
      return;
    }

    this.serverurl = config.serverurl.replace(/\/$/, "");
    this.debug = config.debug || false;
    this.updateInterval = (config.updateInterval || 5) * 1000;

    this.log.info(`LMS Platform initialised → ${this.serverurl}`);

    this.api.on("didFinishLaunching", () => {
      this.log.info("Homebridge ready – discovering LMS players…");
      this.discoverPlayers();
    });
  }

  // ── Discover / register players ──────────────────────────────────

  async discoverPlayers() {
    let players;
    try {
      players = await this.getPlayers();
    } catch (err) {
      this.log.error("discoverPlayers: failed to contact LMS –", err.message);
      return;
    }

    if (!players || players.length === 0) {
      this.log.warn("No players found. Check LMS is running and serverurl is correct.");
      return;
    }

    this.log.info(`Discovered ${players.length} player(s)`);

    for (const player of players) {
      this.log.info(`  • ${player.name}  id=${player.playerid}  model=${player.model}  connected=${player.connected}`);

      const uuid = this.api.hap.uuid.generate(player.playerid);
      const existing = this.accessories.find(a => a.UUID === uuid);

      if (existing) {
        this.log.debug(`Restoring cached accessory: ${player.name}`);
        new LMSPlayerAccessory(this, existing, player);
      } else {
        this.log.info(`Registering new accessory: ${player.name}`);
        const acc = new this.api.platformAccessory(player.name, uuid, Categories.SPEAKER);
        acc.context.player = player;
        new LMSPlayerAccessory(this, acc, player);
        this.api.registerPlatformAccessories("homebridge-lyrion-control", "LMSPlatform", [acc]);
        this.accessories.push(acc);
      }
    }
  }

  // ── LMS JSON-RPC helpers ─────────────────────────────────────────

  async getPlayers() {
    const result = await this.command("", ["players", 0, 99]);
    if (!result || !result.players_loop) return [];
    return result.players_loop.map(p => ({
      playerid: p.playerid,
      name: p.name,
      model: p.model || "squeezelite",
      connected: p.connected === 1,
    }));
  }

  async command(playerid, args) {
    const rpc = { id: 1, method: "slim.request", params: [playerid, args] };
    try {
      const res = await axios.post(`${this.serverurl}/jsonrpc.js`, rpc, { timeout: 4000 });
      if (this.debug) this.log.debug(`RPC [${playerid || "server"}] ${args[0]}:`, JSON.stringify(res.data?.result));
      return res.data?.result ?? null;
    } catch (err) {
      if (this.debug) this.log.error(`RPC error [${playerid}] ${args[0]}:`, err.message);
      return null;
    }
  }

  // ── Required by Homebridge – called for every cached accessory ───

  configureAccessory(accessory) {
    this.log.debug(`Loading cached accessory: ${accessory.displayName}`);
    this.accessories.push(accessory);
  }
}

// ─────────────────────────────────────────────────────────────────
// PLAYER ACCESSORY
// ─────────────────────────────────────────────────────────────────

class LMSPlayerAccessory {
  constructor(platform, accessory, player) {
    this.platform = platform;
    this.accessory = accessory;
    this.player = player;
    this.log = platform.log;

    // Cached state – kept fresh by polling, read instantly on onGet
    this._playing = false;
    this._paused = false;
    this._volume = 50;

    this.accessory.context.player = player;

    // ── Accessory Information ────────────────────────────────────
    (this.accessory.getService(Service.AccessoryInformation)
      || this.accessory.addService(Service.AccessoryInformation))
      .setCharacteristic(Characteristic.Manufacturer, "Lyrion / Logitech")
      .setCharacteristic(Characteristic.Model, player.model || "Squeezelite")
      .setCharacteristic(Characteristic.SerialNumber, player.playerid)
      .setCharacteristic(Characteristic.Name, player.name);

    // ── Fan v2: Active = play/stop, RotationSpeed = volume ───────
    // Siri commands: "Turn on [name]" → play, "Turn off [name]" → stop
    //                "Set [name] to 50%" → volume 50
    this.fanService = this.accessory.getService(Service.Fanv2)
      || this.accessory.addService(Service.Fanv2, player.name);

    this.fanService
      .getCharacteristic(Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    this.fanService
      .getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(this.getVolume.bind(this))
      .onSet(this.setVolume.bind(this));

    // ── SmartSpeaker: explicit play / pause / stop ────────────────
    // iOS 17+ requires ConfiguredName or Siri ignores the service
    this.speakerService = this.accessory.getService(Service.SmartSpeaker)
      || this.accessory.addService(Service.SmartSpeaker, `${player.name} Playback`);

    this.speakerService.setCharacteristic(Characteristic.ConfiguredName, player.name);

    this.speakerService
      .getCharacteristic(Characteristic.CurrentMediaState)
      .onGet(this.getCurrentMediaState.bind(this));

    this.speakerService
      .getCharacteristic(Characteristic.TargetMediaState)
      .onGet(this.getTargetMediaState.bind(this))
      .onSet(this.setTargetMediaState.bind(this));

    // ── Remove legacy Speaker service if present (migration) ──────
    const oldSpeaker = this.accessory.getService(Service.Speaker);
    if (oldSpeaker) {
      this.log.info(`${player.name}: removing legacy Speaker service`);
      this.accessory.removeService(oldSpeaker);
    }

    // Start polling immediately
    this.updateStatus();
    this.pollInterval = setInterval(() => this.updateStatus(), this.platform.updateInterval);
  }

  // ── Fan Active (play / stop) ─────────────────────────────────────

  async getActive() {
    return this._playing ? 1 : 0; // 1=ACTIVE, 0=INACTIVE
  }

  async setActive(value) {
    if (value === 1) {
      this.log.info(`${this.player.name}: play`);
      await this.platform.command(this.player.playerid, ["play"]);
      this._playing = true;
      this._paused = false;
    } else {
      this.log.info(`${this.player.name}: stop`);
      await this.platform.command(this.player.playerid, ["stop"]);
      this._playing = false;
      this._paused = false;
    }
    this._syncSpeakerState();
  }

  // ── Volume via RotationSpeed ─────────────────────────────────────

  async getVolume() {
    return this._volume;
  }

  async setVolume(value) {
    this.log.info(`${this.player.name}: volume → ${value}`);
    this._volume = value;
    await this.platform.command(this.player.playerid, ["mixer", "volume", String(value)]);
  }

  // ── SmartSpeaker media state ─────────────────────────────────────

  async getCurrentMediaState() {
    return this._currentMediaState();
  }

  async getTargetMediaState() {
    return this._targetMediaState();
  }

  async setTargetMediaState(value) {
    if (value === TargetMediaState.PLAY) {
      this.log.info(`${this.player.name}: play (SmartSpeaker)`);
      await this.platform.command(this.player.playerid, ["play"]);
      this._playing = true;
      this._paused = false;
    } else if (value === TargetMediaState.PAUSE) {
      this.log.info(`${this.player.name}: pause`);
      await this.platform.command(this.player.playerid, ["pause", "1"]);
      this._playing = false;
      this._paused = true;
    } else {
      this.log.info(`${this.player.name}: stop (SmartSpeaker)`);
      await this.platform.command(this.player.playerid, ["stop"]);
      this._playing = false;
      this._paused = false;
    }
    this._syncFanState();
  }

  // ── Status polling ───────────────────────────────────────────────

  async updateStatus() {
    const status = await this.platform.command(this.player.playerid, ["status", "-", 1, "tags:al"]);
    if (!status) return;

    const mode = status.mode || "stop";
    this._playing = mode === "play";
    this._paused = mode === "pause";

    if (status.mixer_volume !== undefined) {
      const vol = parseInt(status.mixer_volume);
      this._volume = Math.max(0, Math.min(100, isNaN(vol) ? 0 : vol));
    }

    // Push updates to HomeKit (no-op if value unchanged)
    this.fanService
      .getCharacteristic(Characteristic.Active)
      .updateValue(this._playing ? 1 : 0);

    this.fanService
      .getCharacteristic(Characteristic.RotationSpeed)
      .updateValue(this._volume);

    this.speakerService
      .getCharacteristic(Characteristic.CurrentMediaState)
      .updateValue(this._currentMediaState());

    if (this.platform.debug && status.playlist_loop?.[0]) {
      const t = status.playlist_loop[0];
      this.log.debug(`${this.player.name} ▶ ${t.artist || "?"} – ${t.title || "?"}`);
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────

  _currentMediaState() {
    if (this._playing) return CurrentMediaState.PLAYING;
    if (this._paused)  return CurrentMediaState.PAUSED;
    return CurrentMediaState.STOPPED;
  }

  _targetMediaState() {
    if (this._playing) return TargetMediaState.PLAY;
    if (this._paused)  return TargetMediaState.PAUSE;
    return TargetMediaState.STOP;
  }

  _syncSpeakerState() {
    this.speakerService
      .getCharacteristic(Characteristic.CurrentMediaState)
      .updateValue(this._currentMediaState());
  }

  _syncFanState() {
    this.fanService
      .getCharacteristic(Characteristic.Active)
      .updateValue(this._playing ? 1 : 0);
  }
}

const CARD_VERSION = "0.1.0";
const CARD_TAG = "energy-consumers-card";
const DEFAULTS = {
  title: "Top consumers now",
  count: 6,
  min_power: 1,
  show_bar: true,
  show_rank: false,
  unit: "auto",
};

class EnergyConsumersCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._prefs = undefined;
    this._prefsPromise = undefined;
    this._error = undefined;
  }

  setConfig(config) {
    if (!config || typeof config !== "object") {
      throw new Error("Invalid configuration");
    }

    this.config = { ...DEFAULTS, ...config };

    const count = Number(this.config.count);
    const minPower = Number(this.config.min_power);
    if (!Number.isFinite(count) || count < 1) {
      throw new Error("count must be a number of at least 1");
    }
    if (!Number.isFinite(minPower) || minPower < 0) {
      throw new Error("min_power must be a non-negative number");
    }
    if (!["auto", "W", "kW"].includes(this.config.unit)) {
      throw new Error('unit must be "auto", "W", or "kW"');
    }

    this._render();
  }

  set hass(hass) {
    const firstHass = !this._hass;
    this._hass = hass;

    if (firstHass || (!this._prefs && !this._prefsPromise)) {
      this._loadEnergyPreferences();
      return;
    }

    this._render();
  }

  async _loadEnergyPreferences() {
    if (!this._hass || this._prefsPromise) return;

    this._prefsPromise = this._hass.callWS({ type: "energy/get_prefs" });

    try {
      this._prefs = await this._prefsPromise;
      this._error = undefined;
    } catch (error) {
      this._error = error;
      console.error(`${CARD_TAG}: failed to load Energy dashboard preferences`, error);
    } finally {
      this._prefsPromise = undefined;
      this._render();
    }
  }

  _getConsumers() {
    if (!this._hass || !this._prefs) return [];

    const minPower = Number(this.config?.min_power ?? DEFAULTS.min_power);
    const count = Math.max(1, Math.floor(Number(this.config?.count ?? DEFAULTS.count)));
    const devices = Array.isArray(this._prefs.device_consumption)
      ? this._prefs.device_consumption
      : [];

    return devices
      .filter((device) => typeof device.stat_rate === "string" && device.stat_rate)
      .map((device) => {
        const state = this._hass.states[device.stat_rate];
        if (!state) return null;

        const power = this._toWatts(state.state, state.attributes?.unit_of_measurement);
        if (power === null || power < minPower) return null;

        return {
          entityId: device.stat_rate,
          power,
          name: device.name || state.attributes?.friendly_name || device.stat_rate,
          icon: state.attributes?.icon || "mdi:flash",
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.power - a.power)
      .slice(0, count);
  }

  _toWatts(rawValue, rawUnit) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return null;

    const unit = String(rawUnit || "W").trim().toLowerCase();
    switch (unit) {
      case "w":
        return value;
      case "kw":
        return value * 1_000;
      case "mw":
        return value * 1_000_000;
      default:
        return value;
    }
  }

  _formatPower(watts) {
    const requestedUnit = this.config?.unit ?? DEFAULTS.unit;

    if (requestedUnit === "W") {
      return `${Math.round(watts).toLocaleString()} W`;
    }

    if (requestedUnit === "kW") {
      return `${this._formatKw(watts / 1_000)} kW`;
    }

    if (Math.abs(watts) >= 1_000) {
      return `${this._formatKw(watts / 1_000)} kW`;
    }
    return `${Math.round(watts).toLocaleString()} W`;
  }

  _formatKw(kw) {
    if (Math.abs(kw) >= 10) return kw.toFixed(1);
    return kw.toFixed(2);
  }

  _openMoreInfo(entityId) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      })
    );
  }

  _escape(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  _render() {
    if (!this.shadowRoot || !this.config) return;

    if (!this._hass) {
      this.shadowRoot.innerHTML = this._shell('<div class="message">Waiting for Home Assistant…</div>');
      return;
    }

    if (this._prefsPromise && !this._prefs) {
      this.shadowRoot.innerHTML = this._shell('<div class="message">Loading Energy configuration…</div>');
      return;
    }

    if (this._error) {
      this.shadowRoot.innerHTML = this._shell(
        '<div class="message error">Could not load the Energy dashboard configuration.</div>'
      );
      return;
    }

    const consumers = this._getConsumers();
    const maxPower = consumers[0]?.power || 1;

    const rows = consumers.length
      ? consumers
          .map((item, index) => {
            const width = Math.max(0, Math.min(100, (item.power / maxPower) * 100));
            const rank = this.config.show_rank ? `<span class="rank">${index + 1}</span>` : "";
            const bar = this.config.show_bar
              ? `<div class="bar-track"><div class="bar" style="width:${width}%"></div></div>`
              : "";

            return `
              <button class="consumer" data-entity="${this._escape(item.entityId)}" type="button">
                <div class="row">
                  ${rank}
                  <ha-icon class="icon" icon="${this._escape(item.icon)}"></ha-icon>
                  <span class="name">${this._escape(item.name)}</span>
                  <span class="power">${this._escape(this._formatPower(item.power))}</span>
                </div>
                ${bar}
              </button>`;
          })
          .join("")
      : '<div class="message">No active Energy-dashboard consumers with a live power sensor.</div>';

    this.shadowRoot.innerHTML = this._shell(rows);

    this.shadowRoot.querySelectorAll(".consumer").forEach((element) => {
      element.addEventListener("click", () => this._openMoreInfo(element.dataset.entity));
    });
  }

  _shell(content) {
    const title = this.config?.title
      ? `<div class="header">${this._escape(this.config.title)}</div>`
      : "";

    return `
      <ha-card>
        ${title}
        <div class="content">${content}</div>
      </ha-card>
      <style>
        :host { display: block; }
        ha-card { overflow: hidden; }
        .header {
          padding: 16px 16px 6px;
          font-size: 20px;
          font-weight: 500;
          line-height: 1.3;
        }
        .content { padding: 6px 16px 14px; }
        .consumer {
          display: block;
          width: 100%;
          padding: 8px 0;
          border: 0;
          background: transparent;
          color: var(--primary-text-color);
          font: inherit;
          text-align: left;
          cursor: pointer;
        }
        .consumer:hover { opacity: .82; }
        .consumer:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
          border-radius: 6px;
        }
        .row {
          display: flex;
          align-items: center;
          min-width: 0;
          gap: 9px;
        }
        .rank {
          width: 18px;
          flex: 0 0 18px;
          color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .icon {
          --mdc-icon-size: 20px;
          flex: 0 0 20px;
          color: var(--secondary-text-color);
        }
        .name {
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 14px;
        }
        .power {
          flex: 0 0 auto;
          font-size: 14px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .bar-track {
          height: 5px;
          margin-top: 5px;
          margin-left: 29px;
          overflow: hidden;
          border-radius: 999px;
          background: color-mix(in srgb, var(--primary-text-color) 12%, transparent);
        }
        .bar {
          height: 100%;
          border-radius: inherit;
          background: var(--primary-color);
          transition: width .25s ease;
        }
        .message {
          padding: 12px 0;
          color: var(--secondary-text-color);
          font-size: 14px;
        }
        .error { color: var(--error-color); }
      </style>`;
  }

  getCardSize() {
    return Math.max(2, Number(this.config?.count || DEFAULTS.count) + 1);
  }

  static getStubConfig() {
    return {
      title: DEFAULTS.title,
      count: DEFAULTS.count,
      min_power: DEFAULTS.min_power,
      show_bar: DEFAULTS.show_bar,
    };
  }
}

if (!customElements.get(CARD_TAG)) {
  customElements.define(CARD_TAG, EnergyConsumersCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === CARD_TAG)) {
  window.customCards.push({
    type: CARD_TAG,
    name: "Energy Consumers Card",
    description: "Ranks live power use for devices configured on Home Assistant's Energy dashboard.",
    preview: true,
  });
}

console.info(`%c ENERGY-CONSUMERS-CARD %c v${CARD_VERSION} `, "color:white;background:#03a9f4;font-weight:700;", "color:#03a9f4;background:white;font-weight:700;");

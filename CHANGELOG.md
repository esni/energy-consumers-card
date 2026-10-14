# Changelog

## 0.1.0

- Initial public release.
- Automatically reads individual consumers from Home Assistant's Energy dashboard.
- Uses each configured consumer's live `stat_rate` power sensor.
- Sorts active consumers by instantaneous power.
- Supports top-N display, minimum power threshold, bars, ranks, and W/kW formatting.
- Opens Home Assistant more-info on row click.

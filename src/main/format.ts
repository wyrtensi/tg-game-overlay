import type { Zone } from "../core/zones";
import { t } from "../i18n";

/** Display formatting for the feed-settings sliders and the zone summaries in the profile table. */

export function msToSeconds(ms: number): number {
  return Math.round(ms / 1000);
}

export function secondsToMs(seconds: number): number {
  return Math.round(seconds) * 1000;
}

export function formatTtlLabel(seconds: number): string {
  return t("{n} с", { n: Math.round(seconds) });
}

export function formatOpacityLabel(opacity: number): string {
  return `${Math.round(opacity * 100)}%`;
}

export function formatFontScaleLabel(scale: number): string {
  return `${scale.toFixed(1)}×`;
}

export function formatShadowLabel(shadow: number): string {
  return `${Math.round(shadow * 100)}%`;
}

export function formatFadeLabel(fadeMs: number): string {
  return t("{n} с", { n: (fadeMs / 1000).toFixed(1) });
}

function formatZonePercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatZoneSummary(zone: Zone): string {
  return `${formatZonePercent(zone.x)}, ${formatZonePercent(zone.y)} · ${formatZonePercent(zone.width)}×${formatZonePercent(zone.height)}`;
}

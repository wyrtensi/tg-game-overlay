import type { Zone } from "../core/zones";
import type { Config, DirectionSettings, FeedSettings, Flags, PhraseWheelSettings, Profile } from "./types";

/**
 * Equality checks used to decide whether an incoming config:changed event
 * actually changes anything worth re-rendering for (the app also emits the
 * event as an echo of its own invoke() calls).
 */

export function feedSettingsEqual(a: FeedSettings, b: FeedSettings): boolean {
  return (
    a.ttlMs === b.ttlMs &&
    a.opacity === b.opacity &&
    a.fontScale === b.fontScale &&
    a.textColor === b.textColor &&
    a.authorColor === b.authorColor &&
    a.shadow === b.shadow &&
    a.fadeMs === b.fadeMs &&
    a.stickerAnimationSeconds === b.stickerAnimationSeconds &&
    a.messageLayout === b.messageLayout &&
    a.showAuthor === b.showAuthor &&
    a.showMessageTime === b.showMessageTime &&
    a.incomingBubbleColor === b.incomingBubbleColor &&
    a.outgoingBubbleColor === b.outgoingBubbleColor
  );
}

export function flagsEqual(a: Flags, b: Flags): boolean {
  return a.autostart === b.autostart && a.demoFeed === b.demoFeed;
}

function zoneEqual(a: Zone, b: Zone): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function profileEqual(a: Profile, b: Profile): boolean {
  return (
    a.exe === b.exe &&
    a.title === b.title &&
    a.mode === b.mode &&
    zoneEqual(a.inactive, b.inactive) &&
    zoneEqual(a.active, b.active)
  );
}

export function profilesEqual(a: Profile[], b: Profile[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((profile, index) => profileEqual(profile, b[index]));
}

function directionSettingsEqual(a: DirectionSettings, b: DirectionSettings): boolean {
  return a.enabled === b.enabled && a.upKey === b.upKey && a.downKey === b.downKey && a.leftKey === b.leftKey && a.rightKey === b.rightKey && a.displayMs === b.displayMs;
}

function phraseWheelSettingsEqual(a: PhraseWheelSettings, b: PhraseWheelSettings): boolean {
  return a.enabled === b.enabled && a.hotkey === b.hotkey && a.deadZonePx === b.deadZonePx && a.phrases.every((phrase, index) => phrase === b.phrases[index]) && a.phrases.length === b.phrases.length;
}

export function configsEqual(a: Config, b: Config): boolean {
  return (
    a.hotkey === b.hotkey &&
    a.markupHotkey === b.markupHotkey &&
    directionSettingsEqual(a.directionSignals, b.directionSignals) &&
    phraseWheelSettingsEqual(a.phraseWheel, b.phraseWheel) &&
    feedSettingsEqual(a, b) &&
    flagsEqual(a, b) &&
    profilesEqual(a.profiles, b.profiles) &&
    (a.transport ?? "telegram") === (b.transport ?? "telegram") &&
    (a.language ?? "auto") === (b.language ?? "auto") &&
    relaySettingsEqual(a.relay, b.relay)
  );
}

function relaySettingsEqual(a: Config["relay"], b: Config["relay"]): boolean {
  return (a?.url ?? "") === (b?.url ?? "")
    && (a?.room ?? "") === (b?.room ?? "")
    && (a?.displayName ?? "") === (b?.displayName ?? "");
}

import { describe, it, expect } from 'vitest';
import { cleanHeadshotUrl, hotlinkable } from '../../src/normalize/headshots.js';

describe('cleanHeadshotUrl', () => {
  it('keeps real photos, fixing stray spaces and doubled slashes', () => {
    expect(cleanHeadshotUrl('https://gocreighton.com/images/2026/8/12/Tavares.jpg')).toBe('https://gocreighton.com/images/2026/8/12/Tavares.jpg');
    expect(cleanHeadshotUrl('https://calbears.com /images/2026/8/18/Grimes_Thomas.jpg')).toBe('https://calbears.com/images/2026/8/18/Grimes_Thomas.jpg');
    expect(cleanHeadshotUrl('https://jmusports.com//images/2026/8/8/Ole_Smaaskjaer.png')).toBe('https://jmusports.com/images/2026/8/8/Ole_Smaaskjaer.png');
    expect(cleanHeadshotUrl('https://images.sidearmdev.com/crop?url=https%3A%2F%2Fx%2Fa.jpg&width=100&height=100&type=webp')).toContain('sidearmdev.com/crop?url=');
    expect(cleanHeadshotUrl('https://uclabruins.com/imgproxy/abc/rs:fit:480:0:0:0/q:80/aHR0.jpg')).toContain('/imgproxy/');
  });
  it('drops placeholders and junk', () => {
    expect(cleanHeadshotUrl('https://gowasps.com/info/images/spacer.gif')).toBeNull();
    expect(cleanHeadshotUrl('https://fitchburgfalcons.com/images/setup/default-headshot.png')).toBeNull();
    expect(cleanHeadshotUrl('https://daytonflyers.com/images/logos/Dayton_1Color.png?width=80')).toBeNull();
    expect(cleanHeadshotUrl('')).toBeNull();
    expect(cleanHeadshotUrl(null)).toBeNull();
    expect(cleanHeadshotUrl('/images/2026/a.jpg')).toBeNull();
  });
});

describe('hotlinkable', () => {
  it('refuses every PrestoSports shape and placeholders', () => {
    expect(hotlinkable('https://umbcretrievers.com/images/2026/7/20/Besserhead2.png?width=80')).toBe(true);
    expect(hotlinkable('https://virginiasports.com/imgproxy/x/rs:fit:480:0:0:0/q:80/aHR0.jpg')).toBe(true);
    expect(hotlinkable('https://juniatasports.net/sports/msoc/2026-27/photos/0001/hs_A.jpg')).toBe(false);
    expect(hotlinkable('https://ubknights.com/sports/msoc/2026-27/bios/Masek.jpg?max_height=576&max_width=576&crop=1')).toBe(false);
    expect(hotlinkable('https://fightingmuskies.com/sports/wsoc/head_shots/2026/Holmes.jpg')).toBe(false);
    expect(hotlinkable('https://cdn.prestosports.com/action/cdn/img/x.jpg')).toBe(false);
    expect(hotlinkable('https://gowasps.com/info/images/spacer.gif')).toBe(false);
    expect(hotlinkable(null)).toBe(false);
  });
});

import { personOrNull } from '../../src/normalize/names.js';
describe('personOrNull', () => {
  it('drops stat-crew placeholders for team and bench cards', () => {
    expect(personOrNull('0')).toBeNull();
    expect(personOrNull('#0')).toBeNull();
    expect(personOrNull('TEAM')).toBeNull();
    expect(personOrNull('Bench')).toBeNull();
    expect(personOrNull('')).toBeNull();
    expect(personOrNull('Olivia Goretski')).toBe('Olivia Goretski');
    expect(personOrNull('Goretski, Olivia')).toBe('Goretski, Olivia');
  });
});

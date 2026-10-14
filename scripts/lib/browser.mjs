import puppeteer from 'puppeteer-core';

export const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
export const launch = () => puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });

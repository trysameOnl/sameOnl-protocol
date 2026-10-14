import { initProgress, initReveal, initParallax, initSpotlight } from './effects.js';
import { mountMarket } from './market-ui.js';
import { initContract } from './ca.js';

document.documentElement.classList.add('js');

let register = {};
try { register = JSON.parse(document.getElementById('register').textContent); } catch { register = {}; }

initProgress();
initReveal();
initParallax();
initSpotlight();

if (register.contract?.state === 'stated') initContract(register.chain);

// The market reads one record: the market-source record. Nothing else.
const ms = register['market-source'];
mountMarket({ source: ms && ms.state === 'stated' ? { url: ms.url, pairs: ms.pairs } : null });

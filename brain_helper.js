import { BrainNetwork } from "./brain_network.js";
import { VIBE_STRATEGY_REGISTRY } from "./prompt.js";

const BRAIN_STORAGE_KEY = "ana_beyin_state";
const NUM_NEURONS = 30;

let cachedNetworkInstance = null;

/**
 * Loads the SNN brain network state from chrome.storage.local.
 * If no state exists, it initializes a default network and saves it.
 */
export async function getBrainNetwork() {
  if (cachedNetworkInstance) {
    return cachedNetworkInstance;
  }
  const data = await chrome.storage.local.get(BRAIN_STORAGE_KEY);
  const network = new BrainNetwork();
  
  if (data[BRAIN_STORAGE_KEY]) {
    network.importState(data[BRAIN_STORAGE_KEY]);
  } else {
    network.initializeDefaultNetwork(NUM_NEURONS);
    await saveBrainNetwork(network);
  }
  cachedNetworkInstance = network;
  return network;
}

/**
 * Saves the SNN brain network state to chrome.storage.local.
 */
export async function saveBrainNetwork(network) {
  cachedNetworkInstance = network;
  const exported = network.exportState();
  await chrome.storage.local.set({ [BRAIN_STORAGE_KEY]: exported });
}

/**
 * Steps the SNN simulation based on raw prompt category inputs.
 * Computes dynamic ACh, NE, and DA neuromodulator levels based on neural firing rates.
 */
export async function runBrainSimulation(taskType) {
  const network = await getBrainNetwork();
  
  // Reset dopamine for regular inference phase
  network.DA = 0.0;
  
  const externalInputs = {};
  
  if (taskType && taskType.startsWith("vibecoding_")) {
    const strategy = taskType.split("_")[1];
    const strategyConfig = VIBE_STRATEGY_REGISTRY[strategy] || VIBE_STRATEGY_REGISTRY.standard;
    const inputs = strategyConfig.snnInputs || { focus: 110.0, explore: 2.0 };
    for (let i = 1; i <= 10; i++) externalInputs[i] = inputs.focus;
    for (let i = 11; i <= 20; i++) externalInputs[i] = inputs.explore;
  } else if (taskType === "coding") {
    // High focus / low noise excitation
    for (let i = 1; i <= 10; i++) externalInputs[i] = 110.0;
    for (let i = 11; i <= 20; i++) externalInputs[i] = 2.0;
  } else if (taskType === "analysis") {
    // Balanced focus and systematic proof exploration
    for (let i = 1; i <= 10; i++) externalInputs[i] = 80.0;
    for (let i = 21; i <= 30; i++) externalInputs[i] = 40.0;
  } else if (taskType === "creative") {
    // Low focus / high exploration excitation
    for (let i = 1; i <= 10; i++) externalInputs[i] = 2.0;
    for (let i = 11; i <= 20; i++) externalInputs[i] = 110.0;
  } else if (taskType === "translation" || taskType === "summary") {
    // Sadakat gorevleri: cok yuksek odak, minimum kesif (kaynak metne bagli kal)
    for (let i = 1; i <= 10; i++) externalInputs[i] = 105.0;
    for (let i = 11; i <= 20; i++) externalInputs[i] = 5.0;
  } else if (taskType === "email") {
    // Ton kalibrasyonu: yuksek odak + hafif kesif (uslup secenekleri)
    for (let i = 1; i <= 10; i++) externalInputs[i] = 90.0;
    for (let i = 11; i <= 20; i++) externalInputs[i] = 15.0;
  } else if (taskType === "explain") {
    // Ogretme: dengeli odak + analoji icin orta kesif
    for (let i = 1; i <= 10; i++) externalInputs[i] = 70.0;
    for (let i = 11; i <= 20; i++) externalInputs[i] = 45.0;
  } else if (taskType === "planning") {
    // Planlama: yuksek odak + sistematik akil yurutme (analysis benzeri)
    for (let i = 1; i <= 10; i++) externalInputs[i] = 85.0;
    for (let i = 21; i <= 30; i++) externalInputs[i] = 45.0;
  } else {
    // General tasks have a moderate excitation profile
    for (let i = 1; i <= 30; i++) {
      externalInputs[i] = 50.0;
    }
  }

  const dt = 1.0;
  for (let tick = 0; tick < 80; tick++) {
    const time = tick * dt;
    const fired = network.step(time, dt, externalInputs);
    
    // Calculate category-specific firing intensities
    let focusSpikes = 0;
    let exploreSpikes = 0;
    for (const id of fired) {
      if (id <= 10) focusSpikes++;
      else if (id > 10 && id <= 20) exploreSpikes++;
    }
    
    // Update global neuromodulators dynamically (0.97 decay matches longer retention)
    network.ACh = Math.max(0.1, Math.min(1.0, network.ACh * 0.97 + (focusSpikes / 10) * 0.15));
    network.NE = Math.max(0.1, Math.min(1.0, network.NE * 0.97 + (exploreSpikes / 10) * 0.15));
  }

  // Apply structural homeostasis (synaptic scaling and pruning)
  network.applyHomeostasisAndPruning(5.0, 0.05);
  
  // Persist updated weights
  await saveBrainNetwork(network);

  return {
    ACh: Number(network.ACh.toFixed(3)),
    NE: Number(network.NE.toFixed(3)),
    DA: Number(network.DA.toFixed(3))
  };
}

/**
 * closed-loop Dopaminergic reinforcement learning step.
 * @param {number} rewardVal 1.0 for positive reinforcement (LTP), -1.0 for negative (LTD).
 */
export async function rewardBrain(rewardVal) {
  const network = await getBrainNetwork();
  
  // Set learning signals
  network.DA = rewardVal;
  network.ACh = rewardVal > 0 ? 0.95 : 0.15; // High ACh during LTP to shrink windows and lock weights
  network.NE = rewardVal > 0 ? 0.05 : 0.85;  // High NE during LTD to trigger random explorations

  // Inject strong drive to fire pre-postsynaptic neurons and activate STDP windows
  const dt = 1.0;
  for (let tick = 0; tick < 100; tick++) {
    const externalInputs = {};
    for (let i = 1; i <= NUM_NEURONS; i++) {
      // Fluctuate input currents to trigger sequential spiking across different groups
      externalInputs[i] = 40.0 + Math.random() * 80.0;
    }
    network.step(tick * dt, dt, externalInputs);
  }

  // Apply homeostasis & pruning
  network.applyHomeostasisAndPruning(5.0, 0.05);
  
  // Persist modified states
  await saveBrainNetwork(network);
}

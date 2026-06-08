import { BrainNetwork } from "./brain_network.js";

const BRAIN_STORAGE_KEY = "ana_beyin_state";
const NUM_NEURONS = 30;

/**
 * Loads the SNN brain network state from chrome.storage.local.
 * If no state exists, it initializes a default network and saves it.
 */
export async function getBrainNetwork() {
  const data = await chrome.storage.local.get(BRAIN_STORAGE_KEY);
  const network = new BrainNetwork();
  
  if (data[BRAIN_STORAGE_KEY]) {
    network.importState(data[BRAIN_STORAGE_KEY]);
  } else {
    network.initializeDefaultNetwork(NUM_NEURONS);
    await saveBrainNetwork(network);
  }
  return network;
}

/**
 * Saves the SNN brain network state to chrome.storage.local.
 */
export async function saveBrainNetwork(network) {
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
  
  // Set up inputs to stimulate specific neural sub-populations:
  // - Focus Group (Neurons 1-10): Drives Acetylcholine (ACh)
  // - Exploration Group (Neurons 11-20): Drives Norepinephrine (NE)
  // - Integration Group (Neurons 21-30): Drives Dopamine (DA) base
  if (taskType === "coding") {
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
  } else {
    // General tasks have a moderate excitation profile
    for (let i = 1; i <= 30; i++) {
      externalInputs[i] = 50.0;
    }
  }

  // Run SNN simulation for 80 steps to allow membrane integration
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

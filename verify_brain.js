import { BrainNetwork, Neuron, Synapse, BIOPHYSICAL_CONSTANTS } from "./brain_network.js";

console.log("=================================================");
console.log("      ANA BEYIN ADVANCED VALIDATION RUNNER       ");
console.log("=================================================\n");

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
  console.log(`[PASS] ${message}`);
}

// ----------------------------------------------------------------
// 1. ISOLATED UNIT TESTS
// ----------------------------------------------------------------
console.log("--- 1. Running Component Unit Tests ---");

// Test Neuron Dynamics
const n = new Neuron(1);
assert(n.V === BIOPHYSICAL_CONSTANTS.V_REST, "Neuron starts at V_REST");
n.step(1.0, 10.0, 0.0); // Step with current 10.0 for 1ms
assert(n.V > BIOPHYSICAL_CONSTANTS.V_REST, "Membrane potential increases with positive current");

// Verify Threshold Adaptation after firing
let spikesCount = 0;
n.reset();
for (let step = 0; step < 20; step++) {
  // Inject strong current to guarantee spike
  const fired = n.step(1.0, 150.0, 0.0);
  if (fired) {
    spikesCount++;
    assert(n.V === BIOPHYSICAL_CONSTANTS.V_RESET, "Voltage resets to V_RESET after spike");
    assert(n.theta > 0.0, "Threshold adaptation theta increases after spike");
  }
}
assert(spikesCount > 0, "Neuron fires under strong stimulus");

// Test Synapse STP Dynamics (Tsodyks-Markram)
const s = new Synapse(1, 2, 10.0);
assert(s.u === BIOPHYSICAL_CONSTANTS.U_0, "Synapse starts with baseline utilization U_0");
assert(s.R === 1.0, "Synapse starts with full transmitter resources R = 1.0");

// Transmit spike and verify changes
const cond1 = s.transmit(1.0, 0.0, false);
assert(cond1 > 0, "Synapse transmits positive conductance");
assert(s.u > BIOPHYSICAL_CONSTANTS.U_0, "Spike increases resource utilization (facilitation)");
assert(s.R < 1.0, "Spike depletes available resources (depression)");

// Verify STP Recovery over elapsed time
s.updateSTP(1000.0); // Elapsed 999ms
assert(s.R > 0.9, "Resources recover close to 1.0 after silent period");
assert(s.u < 0.25, "Utilization decays back toward baseline U_0");


// ----------------------------------------------------------------
// 2. STRESS & BOUNDARY SCENARIO TESTING
// ----------------------------------------------------------------
console.log("\n--- 2. Running Stress & Boundary Scenarios ---");

const stressNet = new BrainNetwork();
stressNet.addNeuron(1);
stressNet.addNeuron(2);
stressNet.addSynapse(1, 2, 10.0);

// Scenario A: Extreme Seizure Current (Epileptiform stimulation)
console.log("Scenario A: Injecting extreme current (current = 50000.0)...");
for (let step = 0; step < 50; step++) {
  stressNet.step(step * 1.0, 1.0, { 1: 50000.0 });
}
stressNet.handleFaults();
const neuron1 = stressNet.neurons.get(1);
assert(isFinite(neuron1.V) && !isNaN(neuron1.V), "Membrane potential remains bounded under extreme inputs");
assert(isFinite(neuron1.theta) && !isNaN(neuron1.theta), "Threshold adaptation remains bounded");

// Scenario B: Complete Input Silence Decay (allowing extreme thresholds to cool down)
console.log("Scenario B: Simulating long silence (decay phase for 900ms)...");
for (let step = 50; step < 950; step++) {
  stressNet.step(step * 1.0, 1.0, {});
}
assert(Math.abs(neuron1.V - BIOPHYSICAL_CONSTANTS.V_REST) < 0.1, "Membrane potential leaks back to V_REST during silence");
assert(neuron1.theta < 0.05, "Threshold adaptation decay cools down to base levels");

// Scenario C: Competitive Synaptic Pruning Check
console.log("Scenario C: Running competitive pruning cycle...");
const pruneNet = new BrainNetwork();
pruneNet.addNeuron(1);
pruneNet.addNeuron(2);
pruneNet.addNeuron(3);
pruneNet.addSynapse(2, 1, 100.0); // strong connection
pruneNet.addSynapse(3, 1, 0.01);  // weak connection

pruneNet.applyHomeostasisAndPruning(10.0, 0.1);
const metrics = pruneNet.getSparseMetrics();
assert(metrics.activeSynapsesCount === 1, "Weak connection successfully pruned, keeping active connections sparse");


// ----------------------------------------------------------------
// 3. STATISTICAL & BENCHMARK PERFORMANCE TESTING
// ----------------------------------------------------------------
console.log("\n--- 3. Running Performance Benchmark & Statistical Trace ---");

const benchmarkNet = new BrainNetwork();
const numNeurons = 50;

// Setup a sparse random network of 50 neurons
for (let i = 1; i <= numNeurons; i++) {
  benchmarkNet.addNeuron(i);
}

let synapsesCount = 0;
for (let i = 1; i <= numNeurons; i++) {
  for (let j = 1; j <= numNeurons; j++) {
    if (i !== j && Math.random() < 0.15) { // 15% connection probability
      benchmarkNet.addSynapse(i, j, Math.random() * 5.0);
      synapsesCount++;
    }
  }
}

console.log(`Configured random sparse network: Neurons = ${numNeurons}, Synapses = ${synapsesCount}`);

// Configure global parameters
benchmarkNet.ACh = 0.7;
benchmarkNet.NE = 0.2;
benchmarkNet.DA = 1.0;

// Measure execution latency
const steps = 10000;
console.log(`Running ${steps} steps of simulation...`);
const start = Date.now();

let totalSpikeCount = 0;
for (let step = 0; step < steps; step++) {
  // Inject random currents to mock sensory inputs
  const inputs = {};
  for (let i = 1; i <= numNeurons; i++) {
    if (Math.random() < 0.05) {
      inputs[i] = Math.random() * 30.0;
    }
  }
  
  const fired = benchmarkNet.step(step * 1.0, 1.0, inputs);
  totalSpikeCount += fired.length;
}

const duration = Date.now() - start;
const stepLatency = duration / steps; // average ms per step
const sparseMetrics = benchmarkNet.getSparseMetrics();

console.log("\n--- BENCHMARK RESULTS REPORT ---");
console.log(`Total Simulation Time:    ${duration} ms`);
console.log(`Average Latency per Step: ${stepLatency.toFixed(4)} ms`);
console.log(`Total Spikes Fired:       ${totalSpikeCount}`);
console.log(`Average Spiking Rate:     ${(totalSpikeCount / steps).toFixed(2)} spikes/step`);
console.log(`Sparse Connection Ratio:  ${(sparseMetrics.density * 100).toFixed(2)}%`);
console.log(`Pruning Rate:             ${(sparseMetrics.pruningRate * 100).toFixed(2)}%`);

// ----------------------------------------------------------------
// 4. SERIALIZATION & DESERIALIZATION TESTING
// ----------------------------------------------------------------
console.log("\n--- 4. Running Serialization & Deserialization Tests ---");
const testSerialNet = new BrainNetwork();
testSerialNet.initializeDefaultNetwork(10);
testSerialNet.ACh = 0.88;
testSerialNet.NE = 0.12;
testSerialNet.DA = 0.5;

// Export and verify output structure
const exported = testSerialNet.exportState();
assert(exported.neurons.length === 10, "Exported state contains 10 neurons");
assert(exported.ACh === 0.88, "Exported state preserves ACh value");
assert(exported.NE === 0.12, "Exported state preserves NE value");
assert(exported.DA === 0.5, "Exported state preserves DA value");

// Import into a new network
const importNet = new BrainNetwork();
importNet.importState(exported);
assert(importNet.neurons.size === 10, "Imported network contains 10 neurons");
assert(importNet.ACh === 0.88, "Imported network restores ACh value");
assert(importNet.NE === 0.12, "Imported network restores NE value");
assert(importNet.DA === 0.5, "Imported network restores DA value");

// Verify synapses are restored correctly
const originalMetrics = testSerialNet.getSparseMetrics();
const importedMetrics = importNet.getSparseMetrics();
assert(originalMetrics.activeSynapsesCount === importedMetrics.activeSynapsesCount, "Imported network restores exact synapses count");

console.log("=================================================");

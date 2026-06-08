/**
 * BrainNetwork - High-Performance, Modular, and Fault-Tolerant Neurobiological Simulation
 * Designed for the "Ana Beyin" (Main Brain) Methodology.
 */

// Constant definitions mapping to exact biological ranges
export const BIOPHYSICAL_CONSTANTS = {
  V_REST: -70.0,      // resting membrane potential in mV
  V_RESET: -75.0,     // reset potential after firing in mV
  V_TH_0: -50.0,      // baseline firing threshold in mV
  TAU_M: 20.0,        // membrane time constant in ms
  TAU_THETA: 80.0,    // threshold adaptation time constant in ms
  ALPHA_THETA: 2.0,   // threshold increase magnitude per spike in mV
  BETA_NE: 0.5,       // influence of Norepinephrine on threshold gain
  
  // STP parameters (Tsodyks-Markram)
  U_0: 0.2,           // baseline probability of release
  TAU_F: 600.0,       // facilitation time constant in ms
  TAU_D: 200.0,       // depression recovery time constant in ms
  TAU_SYN: 10.0,      // synaptic current decay time constant in ms
  
  // STDP parameters
  TAU_PLUS: 20.0,     // LTP window time constant in ms
  TAU_MINUS: 20.0,    // LTD window time constant in ms
  A_PLUS: 0.1,        // maximum LTP step
  A_MINUS: 0.12,      // maximum LTD step
  ETA: 0.05,          // base learning rate
  
  // Neuromodulation
  GAMMA_ACH: 0.5,     // recurrent suppression coefficient via Acetylcholine
};

/**
 * Individual Neuron model representing Leaky Integrate-and-Fire with Threshold Adaptation
 */
export class Neuron {
  constructor(id) {
    this.id = id;
    this.V = BIOPHYSICAL_CONSTANTS.V_REST;
    this.theta = 0.0; // Dynamic threshold adaptation component
    this.lastSpikeTime = -Infinity;
  }

  /**
   * Evaluates the membrane voltage and threshold decay for one time step.
   * @param {number} dt Time step size in ms.
   * @param {number} current Total injected and synaptic current.
   * @param {number} NE Global Norepinephrine level [0, 1].
   * @returns {boolean} True if the neuron emitted a spike during this step.
   */
  step(dt, current, NE) {
    // Clamping variables for fault tolerance and to prevent numerical overflow
    if (isNaN(this.V) || !isFinite(this.V)) this.V = BIOPHYSICAL_CONSTANTS.V_REST;
    if (isNaN(this.theta) || !isFinite(this.theta)) this.theta = 0.0;

    // Membrane dynamics: leaky integration of current inputs
    const dV = (-(this.V - BIOPHYSICAL_CONSTANTS.V_REST) + current) * (dt / BIOPHYSICAL_CONSTANTS.TAU_M);
    this.V += dV;

    // Intrinsic threshold adaptation decay
    const dTheta = (-this.theta) * (dt / BIOPHYSICAL_CONSTANTS.TAU_THETA);
    this.theta += dTheta;

    // Check for Spike emission
    const V_threshold = BIOPHYSICAL_CONSTANTS.V_TH_0 + this.theta;
    if (this.V >= V_threshold) {
      this.V = BIOPHYSICAL_CONSTANTS.V_RESET;
      // Norepinephrine scales neuronal excitability/gain
      const gainModifier = 1.0 - BIOPHYSICAL_CONSTANTS.BETA_NE * NE;
      this.theta += BIOPHYSICAL_CONSTANTS.ALPHA_THETA * Math.max(0.1, gainModifier);
      return true;
    }

    return false;
  }

  reset() {
    this.V = BIOPHYSICAL_CONSTANTS.V_REST;
    this.theta = 0.0;
    this.lastSpikeTime = -Infinity;
  }
}

/**
 * Synapse model implementing Tsodyks-Markram Short-Term Plasticity (STP)
 */
export class Synapse {
  constructor(preId, postId, initialWeight = 1.0) {
    this.preId = preId;
    this.postId = postId;
    
    // Absolute weight (Long-Term Plasticity target)
    this.W = Math.max(0.0, initialWeight);
    
    // Tsodyks-Markram STP states
    this.u = BIOPHYSICAL_CONSTANTS.U_0; // resource utilization probability
    this.R = 1.0;                       // fraction of available resources
    this.lastStpUpdate = 0.0;
  }

  /**
   * Updates STP states exponentially over elapsed time since last update.
   * @param {number} t Current simulation time in ms.
   */
  updateSTP(t) {
    const dt = t - this.lastStpUpdate;
    if (dt > 0) {
      const u0 = BIOPHYSICAL_CONSTANTS.U_0;
      const tauF = BIOPHYSICAL_CONSTANTS.TAU_F;
      const tauD = BIOPHYSICAL_CONSTANTS.TAU_D;

      // Exponential decay back to baseline states
      this.u = u0 + (this.u - u0) * Math.exp(-dt / tauF);
      this.R = 1.0 + (this.R - 1.0) * Math.exp(-dt / tauD);
      this.lastStpUpdate = t;

      // Clamp variables to prevent NaN or numerical creep
      this.clampStates();
    }
  }

  /**
   * Simulates transmitter release upon spike propagation and returns active conductance.
   * @param {number} t Arrival time of spike.
   * @param {number} ACh Acetylcholine level [0, 1].
   * @param {boolean} isRecurrent Whether this is a recurrent network link.
   * @returns {number} Emitted synaptic conductance.
   */
  transmit(t, ACh, isRecurrent) {
    this.updateSTP(t);

    const currentU = this.u;
    const currentR = this.R;
    const releaseFraction = currentU * currentR;

    let conductance = this.W * releaseFraction;

    // Recurrent network inhibition modulated by Acetylcholine (ACh)
    if (isRecurrent) {
      conductance *= (1.0 - BIOPHYSICAL_CONSTANTS.GAMMA_ACH * ACh);
    }

    // Step Tsodyks-Markram vesicles/resources consumption
    this.u += BIOPHYSICAL_CONSTANTS.U_0 * (1.0 - currentU);
    this.R -= releaseFraction;

    this.clampStates();

    return Math.max(0.0, conductance);
  }

  clampStates() {
    if (isNaN(this.u) || this.u < 0 || this.u > 1.0) this.u = BIOPHYSICAL_CONSTANTS.U_0;
    if (isNaN(this.R) || this.R < 0 || this.R > 1.0) this.R = 1.0;
    if (isNaN(this.W) || !isFinite(this.W)) this.W = 0.0;
    this.W = Math.max(0.0, this.W);
  }
}

/**
 * Spiking Neural Network Orchestrator matching Ana Beyin requirements
 */
export class BrainNetwork {
  constructor() {
    this.neurons = new Map();
    // Adjacency matrix represented as nested map: postsynaptic -> (presynaptic -> Synapse)
    this.synapses = new Map();
    
    // Neuromodulators controlling exploration/exploitation
    this.ACh = 0.5;
    this.NE = 0.5;
    this.DA = 0.0;
  }

  addNeuron(id) {
    if (!this.neurons.has(id)) {
      this.neurons.set(id, new Neuron(id));
      this.synapses.set(id, new Map());
    }
  }

  addSynapse(preId, postId, initialWeight = 1.0) {
    this.addNeuron(preId);
    this.addNeuron(postId);

    const postSynapses = this.synapses.get(postId);
    if (!postSynapses.has(preId)) {
      postSynapses.set(preId, new Synapse(preId, postId, initialWeight));
    }
  }

  /**
   * Executes a step of the simulation.
   * @param {number} t Current simulation time in ms.
   * @param {number} dt Time step size in ms.
   * @param {Object} externalInputs Map of neuronId -> inputCurrent.
   * @returns {Array} List of neuron IDs that fired during this step.
   */
  step(t, dt, externalInputs = {}) {
    // 1. Recover system from NaN values if any (Fault-Tolerance Hook)
    this.handleFaults();

    const firedNeurons = [];
    const incomingSynapticCurrents = {};

    // Initialize currents
    for (const id of this.neurons.keys()) {
      incomingSynapticCurrents[id] = 0.0;
    }

    // 2. Compute synaptic current propagation for active presynaptic spikes
    // (Since we use sparse connections, we only iterate over existing synapses)
    for (const [postId, preMap] of this.synapses.entries()) {
      for (const [preId, synapse] of preMap.entries()) {
        const preNeuron = this.neurons.get(preId);
        
        // Check if preNeuron spiked in the previous step
        if (preNeuron.lastSpikeTime === t - dt) {
          const isRecurrent = preId !== postId;
          const conductance = synapse.transmit(t, this.ACh, isRecurrent);
          incomingSynapticCurrents[postId] += conductance;
        }
      }
    }

    // 3. Step individual neurons
    for (const [id, neuron] of this.neurons.entries()) {
      const extInput = externalInputs[id] || 0.0;
      const totalCurrent = incomingSynapticCurrents[id] + extInput;
      
      const didSpike = neuron.step(dt, totalCurrent, this.NE);
      if (didSpike) {
        neuron.lastSpikeTime = t;
        firedNeurons.push(id);
      }
    }

    // 4. Update Synaptic Weights via Three-Factor STDP
    for (const postId of firedNeurons) {
      const preMap = this.synapses.get(postId);
      const postNeuron = this.neurons.get(postId);

      for (const [preId, synapse] of preMap.entries()) {
        const preNeuron = this.neurons.get(preId);
        
        if (preNeuron.lastSpikeTime !== -Infinity) {
          const dt_stdp = postNeuron.lastSpikeTime - preNeuron.lastSpikeTime;
          
          // Presynaptic before postsynaptic spike (LTP Window)
          if (dt_stdp > 0 && dt_stdp < 50.0) {
            // Three-factor reward mapping (DA * ACh)
            const M = this.DA * this.ACh;
            const tau_ltp = BIOPHYSICAL_CONSTANTS.TAU_PLUS / (1.0 + this.ACh);
            
            const dw = BIOPHYSICAL_CONSTANTS.ETA * M * BIOPHYSICAL_CONSTANTS.A_PLUS * Math.exp(-dt_stdp / tau_ltp);
            synapse.W += dw;
            synapse.clampStates();
          }
        }
      }
    }

    return firedNeurons;
  }

  /**
   * Homeostatic normalization and synaptic pruning to optimize efficiency.
   * @param {number} wTarget Sum of target incoming weights per neuron.
   * @param {number} thetaPrune Threshold under which a synapse is pruned.
   */
  applyHomeostasisAndPruning(wTarget = 5.0, thetaPrune = 0.05) {
    for (const [postId, preMap] of this.synapses.entries()) {
      let totalWeight = 0.0;
      for (const synapse of preMap.values()) {
        totalWeight += synapse.W;
      }

      if (totalWeight > 0.0) {
        const scale = wTarget / totalWeight;
        const toPrune = [];

        for (const [preId, synapse] of preMap.entries()) {
          // Perform scaling
          synapse.W *= scale;
          
          // Prune weak synapses
          if (synapse.W < thetaPrune) {
            toPrune.push(preId);
          } else {
            synapse.clampStates();
          }
        }

        // Sever connection references (Structural plasticity)
        for (const preId of toPrune) {
          preMap.delete(preId);
        }
      }
    }
  }

  /**
   * Fault-tolerance controller detecting state errors, resetting values, and preventing system crashes.
   */
  handleFaults() {
    // Sanitize global values
    if (isNaN(this.ACh) || this.ACh < 0 || this.ACh > 1.0) this.ACh = 0.5;
    if (isNaN(this.NE) || this.NE < 0 || this.NE > 1.0) this.NE = 0.5;
    if (isNaN(this.DA) || this.DA < -2.0 || this.DA > 2.0) this.DA = 0.0;

    // Sanitize neurons
    for (const neuron of this.neurons.values()) {
      if (isNaN(neuron.V) || !isFinite(neuron.V)) neuron.V = BIOPHYSICAL_CONSTANTS.V_REST;
      if (isNaN(neuron.theta) || !isFinite(neuron.theta)) neuron.theta = 0.0;
    }

    // Sanitize synapses
    for (const preMap of this.synapses.values()) {
      for (const synapse of preMap.values()) {
        synapse.clampStates();
      }
    }
  }

  /**
   * Computes connection density metrics for analysis.
   */
  getSparseMetrics() {
    const N = this.neurons.size;
    let activeSynapsesCount = 0;
    
    for (const preMap of this.synapses.values()) {
      activeSynapsesCount += preMap.size;
    }

    const maxSynapses = N * (N - 1);
    const density = maxSynapses > 0 ? activeSynapsesCount / maxSynapses : 0.0;
    const pruningRate = 1.0 - density;

    return {
      neuronsCount: N,
      activeSynapsesCount,
      density,
      pruningRate
    };
  }

  /**
   * Exports the entire network state to a plain JavaScript object.
   */
  exportState() {
    const neuronsList = [];
    for (const [id, n] of this.neurons.entries()) {
      neuronsList.push({
        id,
        V: n.V,
        theta: n.theta,
        lastSpikeTime: n.lastSpikeTime
      });
    }

    const synapsesList = [];
    for (const [postId, preMap] of this.synapses.entries()) {
      for (const [preId, s] of preMap.entries()) {
        synapsesList.push({
          preId,
          postId,
          W: s.W,
          u: s.u,
          R: s.R,
          lastStpUpdate: s.lastStpUpdate
        });
      }
    }

    return {
      neurons: neuronsList,
      synapses: synapsesList,
      ACh: this.ACh,
      NE: this.NE,
      DA: this.DA
    };
  }

  /**
   * Imports the network state from a plain JavaScript object.
   */
  importState(state) {
    if (!state) return;
    this.neurons.clear();
    this.synapses.clear();

    if (state.ACh !== undefined) this.ACh = state.ACh;
    if (state.NE !== undefined) this.NE = state.NE;
    if (state.DA !== undefined) this.DA = state.DA;

    if (Array.isArray(state.neurons)) {
      for (const nState of state.neurons) {
        const n = new Neuron(nState.id);
        n.V = nState.V;
        n.theta = nState.theta;
        n.lastSpikeTime = nState.lastSpikeTime;
        this.neurons.set(nState.id, n);
        this.synapses.set(nState.id, new Map());
      }
    }

    if (Array.isArray(state.synapses)) {
      for (const sState of state.synapses) {
        this.addNeuron(sState.preId);
        this.addNeuron(sState.postId);
        const s = new Synapse(sState.preId, sState.postId, sState.W);
        s.u = sState.u;
        s.R = sState.R;
        s.lastStpUpdate = sState.lastStpUpdate;
        this.synapses.get(sState.postId).set(sState.preId, s);
      }
    }
  }

  /**
   * Initializes a random sparse recurrent neural network.
   */
  initializeDefaultNetwork(numNeurons = 30) {
    this.neurons.clear();
    this.synapses.clear();
    
    // Add neurons
    for (let i = 1; i <= numNeurons; i++) {
      this.addNeuron(i);
    }

    // Connect them randomly with sparse connectivity (~15% probability)
    for (let i = 1; i <= numNeurons; i++) {
      for (let j = 1; j <= numNeurons; j++) {
        if (i !== j && Math.random() < 0.15) {
          const initialWeight = 0.5 + Math.random() * 2.5;
          this.addSynapse(i, j, initialWeight);
        }
      }
    }

    this.ACh = 0.5;
    this.NE = 0.5;
    this.DA = 0.0;
  }
}

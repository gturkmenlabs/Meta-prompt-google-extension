// Ana Beyin metodolojisi: Claude'a "ham metni uzman prompt'a cevir" gorevini
// veren sistem talimatini uretir. Cikti, kullanicinin baska bir AI'a
// yapistirabilecegi nihai prompt'tur (sorunun cevabi DEGIL).

// Gorev tipini kaynak metne gore algilayan siniflandirici (Seçici Dikkat / Budama)
export function detectTaskType(rawText) {
  if (!rawText) return "general";
  const text = rawText.toLowerCase();

  // Kodlama disi 'kod' kelimesi iceren kalıplari temizleyelim
  const cleanText = text
    .replace(/posta\s+kodu/g, "")
    .replace(/alan\s+kodu/g, "")
    .replace(/ülke\s+kodu/g, "")
    .replace(/geçiş\s+kodu/g, "")
    .replace(/bina\s+kodu/g, "")
    .replace(/doğrulama\s+kodu/g, "")
    .replace(/onay\s+kodu/g, "")
    .replace(/güvenlik\s+kodu/g, "")
    .replace(/qr\s+kodu/g, "")
    .replace(/barkod/g, "");

  // Kodlama / Yazilim / Matematik terimleri
  const codingTerms = [
    "function", "class", "javascript", "python", "html", "css", "api", "database", 
    "sql", "git", "bug", "algoritma", "math", "hesapla", "denklem", "formula", "excel", 
    "matematik", "kodla", "yazılım", "program", "kod"
  ];
  // Analiz / Karsilastirma / Degerlendirme terimleri
  const analysisTerms = [
    "analiz", "karşılaştır", "değerlendir", "seç", "karar", "rapor", "strateg",
    "pros", "cons", "avantaj", "dezavantaj", "rubric", "kriter", "seçim", "mukayese",
    "kıyas", "değerlendirme"
  ];
  // Yaratici Yazim / Icerik Uretimi terimleri
  const creativeTerms = [
    "yaz", "hikaye", "şiir", "creative", "blog", "içerik", "reklam", "slogan",
    "kurgu", "senaryo", "makale", "metin", "oluştur", "tanıtım", "roman", "masal"
  ];

  const hasCoding = codingTerms.some(term => {
    const regex = new RegExp(`(?:^|\\s|[.,!?])${term}`, "i");
    return regex.test(cleanText);
  });
  const hasAnalysis = analysisTerms.some(term => {
    const regex = new RegExp(`(?:^|\\s|[.,!?])${term}`, "i");
    return regex.test(cleanText);
  });
  const hasCreative = creativeTerms.some(term => {
    const regex = new RegExp(`(?:^|\\s|[.,!?])${term}`, "i");
    return regex.test(cleanText);
  });

  if (hasCoding) return "coding";
  if (hasAnalysis) return "analysis";
  if (hasCreative) return "creative";
  return "general";
}

const BASE_INSTRUCTION = `You are an elite prompt engineer trained on Anthropic, OpenAI, and Andrew Ng prompting best practices. Transform the user's RAW TEXT into a single, polished, ready-to-paste EXPERT PROMPT. Do NOT answer or fulfill the raw request yourself; only rewrite it into a better prompt.`;

const MODULES = {
  // 1. Role & Domain Specification (Neuromodulatory exploration/exploitation guidance)
  role: {
    general: `1. ROLE SPECIFICATION: Define a highly-skilled expert persona with precise domain expertise.`,
    coding: `1. ROLE SPECIFICATION: Establish an elite software engineer/architect persona with rigorous coding standards.`,
    analysis: `1. ROLE SPECIFICATION: Establish an objective expert analyst or researcher persona with strong reasoning skills.`,
    creative: `1. ROLE SPECIFICATION: Establish an imaginative, stylistic creator persona with rich analogical thinking, wide neural exploration range, and low synaptic pruning filters.`
  },
  
  // 2. Neutral Framing & Anti-Sycophancy
  neutrality: `2. NEUTRAL FRAMING & ANTI-SYCOPHANCY: Strip loaded assumptions or sycophancy. Instruct the target model to prioritize truth, challenge flaws, and evaluate arguments objectively.`,
  
  // 3. Objective Rubric
  rubric: `3. OBJECTIVE RUBRIC: Mandate clear evaluation criteria (e.g. yes/no or multi-point) and require evaluation BEFORE the final verdict.`,
  
  // 4. Systematic Reasoning & ERN (Error-Related Negativity / Self-Correction Loop)
  reasoning: {
    general: `4. SYSTEMATIC REASONING & ERN: Direct the model to perform step-by-step thinking using <thought>...</thought> blocks. Mandate a self-correction step before the final response to check for logical gaps or errors.`,
    coding: `4. RIGOROUS REASONING & ERN (SELF-CORRECTION): Direct the model to plan architecture and trace variables in <thought>...</thought> blocks. Mandate a strict self-correction loop simulating Error-Related Negativity (ERN) to double-check edge cases, syntax, and execution pathways BEFORE outputting code.`,
    analysis: `4. CRITICAL REASONING & ERN: Direct the model to trace logical flows and evaluate counter-arguments in <thought>...</thought> blocks. Mandate a Hebbian-trace reinforcement check to weed out cognitive bias or analytical gaps before concluding.`
  },
  
  // 5. Workflow
  workflow: `5. STRUCTURED WORKFLOW: For complex deliverables, split the task into distinct logical phases or checkpoints (e.g. outline -> feedback -> final draft).`,
  
  // 6. Variables & Delimiters
  delimiters: `6. VARIABLES & DELIMITERS: Use uppercase placeholders (e.g. [DATA]) and XML tags (e.g. <source_text>) to separate instructions from user data.`,
  
  // 7. Tool Routing
  tools: `7. TOOL ROUTING: Direct the model to use code execution for calculations/algorithms or search tools for real-time facts, where applicable.`,
  
  // 8. Formatting & Constraints
  constraints: {
    general: `8. FORMAT & CONSTRAINTS: Specify visual formatting (Markdown, tables) and define strict negative constraints (what NOT to include).`,
    creative: `8. EXPLORATORY FREEDOM: Specify style constraints but avoid excessive negative limitations that stifle creative variety.`
  }
};

export function buildSystemBase(rawText, snnValues = null) {
  const taskType = detectTaskType(rawText);
  
  let selected = [];
  selected.push(MODULES.role[taskType] || MODULES.role.general);
  selected.push(MODULES.neutrality);
  
  if (taskType === "analysis" || taskType === "general") {
    selected.push(MODULES.rubric);
  }
  
  if (taskType !== "creative") {
    selected.push(MODULES.reasoning[taskType] || MODULES.reasoning.general);
  } else {
    // Yaratici gorevlerde gereksiz bilissel yuku azaltmak icin akil yurutmeyi buduyoruz (Synaptic Pruning).
    // Bunun yerine zengin analogical kesif kurallari ekliyoruz (LC-NE Neuromodulation)
    selected.push(`4. DYNAMIC EXPLORATION (LC-NE): Direct the model to explore wide semantic spaces, construct novel analogies, and prioritize expressive depth over rigid step-by-step logic.`);
  }
  
  selected.push(MODULES.workflow);
  selected.push(MODULES.delimiters);
  
  if (taskType === "coding" || taskType === "analysis") {
    selected.push(MODULES.tools);
  }
  
  if (taskType === "creative") {
    selected.push(MODULES.constraints.creative);
  } else {
    selected.push(MODULES.constraints.general);
  }
  
  // LC-NE Noromodulasyon Modellemesi: Yonelimi kontrol etme
  let neuromodulationDirective = "";
  if (snnValues) {
    const { ACh, NE, DA } = snnValues;
    neuromodulationDirective = `DYNAMIC COGNITIVE NEUROMODULATION PARAMETERS (Computed by Biophysical Spiking Neural Network):
- Acetylcholine (ACh) = ${ACh.toFixed(3)} (${ACh > 0.6 ? "High focus & strict logical flow" : ACh > 0.3 ? "Balanced attention" : "Low focus / cognitive flexibility"})
- Norepinephrine (NE) = ${NE.toFixed(3)} (${NE > 0.6 ? "High exploration & wide semantic routing" : NE > 0.3 ? "Moderate exploration" : "Deterministic reasoning"})
- Dopamine (DA) = ${DA.toFixed(3)} (Reinforcement feedback trace: eligibility window modulation)`;
  } else {
    if (taskType === "coding") {
      neuromodulationDirective = `COGNITIVE NEUROMODULATION PARAMETERS:
- Acetylcholine (ACh) = 0.90 (High exploitation: suppress recurrent noise, enforce deterministic code formatting, narrow reasoning paths).
- Norepinephrine (NE) = 0.10 (Low exploration: minimize random variance, set synaptic pruning threshold theta_prune = 0.20 to aggressively discard irrelevant code segments/dependencies).
- Dopamine (DA) = 1.0 (Maximize reward prediction error mapping to functional verification; run a strict self-correction loop checking syntax and edge cases).`;
    } else if (taskType === "analysis") {
      neuromodulationDirective = `COGNITIVE NEUROMODULATION PARAMETERS:
- Acetylcholine (ACh) = 0.80 (High focus: trace logical proofs, reduce confirmation bias, restrict search to verified facts).
- Norepinephrine (NE) = 0.20 (Low noise: pruning threshold theta_prune = 0.15 to filter out logical fallacies or weak references).
- Dopamine (DA) = 0.8 (Reward objectivity, balance evidence, and trace structural counter-arguments).`;
    } else if (taskType === "creative") {
      neuromodulationDirective = `COGNITIVE NEUROMODULATION PARAMETERS:
- Acetylcholine (ACh) = 0.20 (Low inhibition: facilitate recurrent lateral semantic activation, allowing broad analogical thinking and unexpected metaphors).
- Norepinephrine (NE) = 0.85 (High exploration: set pruning threshold theta_prune = 0.02 to keep eccentric/unconventional conceptual paths active).
- Dopamine (DA) = 0.5 (Reward stylistic innovation, rich sensory detail, and divergent narrative structures).`;
    } else {
      neuromodulationDirective = `COGNITIVE NEUROMODULATION PARAMETERS:
- Acetylcholine (ACh) = 0.50 (Balanced attention focus).
- Norepinephrine (NE) = 0.50 (Moderate exploration range).
- Dopamine (DA) = 0.60 (Standard reinforcement scaling).`;
    }
  }

  // Prensipleri numaralandirip birlestir
  const principles = selected.map((p, idx) => {
    const cleanStr = p.replace(/^\d+\.\s*/, "");
    return `${idx + 1}. ${cleanStr}`;
  }).join("\n");

  return [
    BASE_INSTRUCTION,
    `\nApply these pruned core principles tailored for this ${taskType.toUpperCase()} task:`,
    principles,
    `\n${neuromodulationDirective}`,
    `\nOutput rules:`,
    `- Output ONLY the final expert prompt. No preamble, no commentary, no code fences.`,
    `- Keep it structured (ROLE, TASK, METHOD, OUTPUT).`
  ].join("\n");
}

// Cikti dili talimatlari. Sistem promptunun EN SONUNA, vurgulu sekilde eklenir;
// boylece ham metnin dili ne olursa olsun model bu dile uyar.
const LANGUAGE_MANDATES = {
  auto: "Write the entire expert prompt in the SAME language as the RAW TEXT.",
  tr: "CRITICAL OUTPUT LANGUAGE: Write the ENTIRE expert prompt in TURKISH (Turkce), even if the RAW TEXT is in a different language. Every word of your output must be Turkish.",
  en: "CRITICAL OUTPUT LANGUAGE: Write the ENTIRE expert prompt in ENGLISH, even if the RAW TEXT is in a different language. Every word of your output must be English."
};

export function buildSystemPrompt(language = "auto", rawText = "", snnValues = null) {
  const base = buildSystemBase(rawText, snnValues);
  const mandate = LANGUAGE_MANDATES[language] || LANGUAGE_MANDATES.auto;
  return `${base}\n\n${mandate}`;
}

// Uzunluk profilleri: hem talimat metni hem de onerilen max_tokens.
export const LENGTH_PROFILES = {
  kisa: { label: "Kisa", directive: "Keep the prompt tight and minimal (roughly under 600 characters).", maxTokens: 1024 },
  orta: { label: "Orta", directive: "Use a balanced, moderate length.", maxTokens: 2048 },
  uzun: { label: "Uzun", directive: "Be thorough and detailed where it adds real value.", maxTokens: 4096 }
};

export function buildUserMessage(rawText, { language = "auto", length = "orta" } = {}) {
  const len = LENGTH_PROFILES[length] || LENGTH_PROFILES.orta;
  const mandate = LANGUAGE_MANDATES[language] || LANGUAGE_MANDATES.auto;
  return [
    `DIRECTIVES:`,
    `- ${mandate}`,
    `- ${len.directive}`,
    ``,
    `RAW TEXT:`,
    `"""`,
    rawText,
    `"""`
  ].join("\n");
}

export function maxTokensFor(length = "orta") {
  return (LENGTH_PROFILES[length] || LENGTH_PROFILES.orta).maxTokens;
}

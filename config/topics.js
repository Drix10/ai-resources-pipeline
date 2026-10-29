/**
 * The topic pages the pipeline writes into the resources repo (topics/<slug>.md, src/services/kbTopics.js).
 * A briefing belongs to a topic when `match` finds its headline or its first paragraph. `lab: true` marks a
 * maker of models and products: a headline that names one and says it released something goes on TIMELINE.md.
 * Edit freely: a new entry gets its page on the next daily build.
 */
module.exports = [
  { slug: "openai", name: "OpenAI", lab: true, about: "OpenAI, ChatGPT, GPT models, Sora and Codex.", match: /\bOpenAI\b|\bChatGPT\b|\bGPT-\d|\bSora\b|\bCodex\b/ },
  { slug: "anthropic", name: "Anthropic", lab: true, about: "Anthropic and the Claude models, apps and Claude Code.", match: /\bAnthropic\b|\bClaude\b/ },
  { slug: "google-deepmind", name: "Google DeepMind", lab: true, about: "Google DeepMind, Gemini, Gemma, Veo and Google's AI products.", match: /\bDeepMind\b|\bGemini\b|\bGemma\b|\bVeo\b|\bGoogle AI\b|\bNotebookLM\b/ },
  { slug: "meta-ai", name: "Meta AI", lab: true, about: "Meta's AI work: Llama, Meta AI and its research labs.", match: /\bMeta(?![-\w])|\bLlama\b|\bFAIR\b/ },
  { slug: "xai", name: "xAI", lab: true, about: "xAI and Grok.", match: /\bxAI\b|\bGrok\b/ },
  { slug: "mistral", name: "Mistral AI", lab: true, about: "Mistral AI and its models.", match: /\bMistral\b|\bMagistral\b|\bDevstral\b|\bCodestral\b/ },
  { slug: "nvidia", name: "NVIDIA", lab: true, about: "NVIDIA: GPUs, CUDA, Nemotron and its AI platforms.", match: /\bNVIDIA\b|\bNvidia\b|\bNemotron\b|\bCUDA\b/ },
  { slug: "microsoft", name: "Microsoft", lab: true, about: "Microsoft, Copilot, Azure AI and the Phi models.", match: /\bMicrosoft\b|\bCopilot\b|\bAzure\b|\bPhi-\d/ },
  { slug: "apple", name: "Apple", lab: true, about: "Apple Intelligence, Apple silicon and Apple's AI moves.", match: /\bApple\b|\bVision Pro\b|\bMLX\b/ },
  { slug: "amazon", name: "Amazon & AWS", lab: true, about: "Amazon, AWS, Bedrock and Alexa.", match: /\bAmazon\b|\bAWS\b|\bBedrock\b|\bAlexa\b/ },
  { slug: "deepseek", name: "DeepSeek", lab: true, about: "DeepSeek and its open models.", match: /\bDeepSeek\b/i },
  { slug: "qwen-alibaba", name: "Qwen & Alibaba", lab: true, about: "Alibaba, the Qwen models and Wan.", match: /\bQwen\d*\b|\bAlibaba\b/i },
  { slug: "hugging-face", name: "Hugging Face", lab: true, about: "Hugging Face: the Hub, its libraries and the models shared there.", match: /\bHugging ?Face\b/i },
  { slug: "perplexity", name: "Perplexity", lab: true, about: "Perplexity and Comet.", match: /\bPerplexity\b/ },
  { slug: "cursor", name: "Cursor", lab: true, about: "Cursor, the AI code editor.", match: /\bCursor\b/ },
  { slug: "ai-agents", name: "AI agents", about: "Agents that plan and act: coding agents, browser agents and the tools to build them.", match: /\bagents?\b|\bagentic\b/i },
  { slug: "mcp", name: "MCP", about: "The Model Context Protocol: servers, clients and the tools built on it.", match: /\bMCP\b|\bModel Context Protocol\b/i },
  { slug: "open-weight-models", name: "Open-weight models", about: "Models whose weights anyone can download.", match: /\bopen[- ]weights?\b|\bopen[- ]source (?:\w+ )?(?:model|LLM)s?\b/i },
  { slug: "funding-and-acquisitions", name: "Funding & acquisitions", about: "Rounds, raises and deals.", match: /\bSeries [A-H]\b|\bseed (?:round|funding)\b|\bfunding round\b|\brais(?:es|ed|ing) \$|\bacquires?\b|\bacquired\b|\bacquisition\b/i },
  { slug: "robotics", name: "Robotics", about: "Robots, humanoids and robot learning.", match: /\brobot(?:s|ics)?\b|\bhumanoids?\b/i },
  { slug: "ai-policy", name: "AI policy", about: "Laws, regulators and governments on AI.", match: /\bAI Act\b|\bregulat(?:ion|ions|ors?|ory)\b|\bexecutive order\b|\blegislation\b|\bAI (?:policy|safety institute)\b/i },
  { slug: "chips-and-compute", name: "Chips & compute", about: "GPUs, TPUs, accelerators and data centers.", match: /\bGPUs?\b|\bTPUs?\b|\bdata cent(?:er|re)s?\b|\bsemiconductors?\b|\bAI chips?\b/i },
  { slug: "video-generation", name: "Video generation", about: "Models and tools that make video.", match: /\bvideo (?:model|generation|generator)s?\b|\btext-to-video\b|\bSora\b|\bVeo\b|\bRunway\b|\bKling\b/i },
];

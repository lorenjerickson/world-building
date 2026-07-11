export type ActivityGroupKey = "get-started" | "style" | "design" | "planning";

export type Activity = {
  id: string;
  title: string;
  description: string;
  impact: "High" | "Medium";
  effort: string;
  tags: string[];
  whyItMatters: string;
  deliverable: string;
  canSkip: boolean;
};

export type ActivityGroup = {
  id: ActivityGroupKey;
  title: string;
  eyebrow: string;
  summary: string;
  goal: string;
  activities: Activity[];
};

export type RemodelPlan = {
  homeowner: {
    firstName: string;
    projectName: string;
    targetStart: string;
  };
  groups: ActivityGroup[];
};

export const remodelPlan: RemodelPlan = {
  homeowner: {
    firstName: "Maya",
    projectName: "Kitchen Remodel",
    targetStart: "Late Summer",
  },
  groups: [
    {
      id: "get-started",
      title: "Get Started",
      eyebrow: "Orientation",
      summary:
        "Figure out where you are in the remodel journey and which foundational decisions need attention first.",
      goal: "Clarify scope, priorities, and readiness before expensive decisions pile up.",
      activities: [
        {
          id: "readiness-check",
          title: "Take a remodel readiness check",
          description:
            "Assess decision confidence, urgency, home constraints, and how much guidance you need.",
          impact: "High",
          effort: "10 min",
          tags: ["Readiness", "Scope"],
          whyItMatters:
            "A quick self-assessment keeps the project paced to your actual readiness instead of jumping straight into materials or contractor outreach.",
          deliverable: "A starting point with recommended next activities.",
          canSkip: false,
        },
        {
          id: "project-priorities",
          title: "Rank what matters most",
          description:
            "Choose your top remodel drivers like storage, entertaining, resale, durability, or accessibility.",
          impact: "High",
          effort: "15 min",
          tags: ["Goals", "Tradeoffs"],
          whyItMatters:
            "Priority ranking helps you make smarter tradeoffs when budget, layout, or material choices compete with each other.",
          deliverable: "A short list of project goals to guide later decisions.",
          canSkip: false,
        },
        {
          id: "existing-pain-points",
          title: "Capture current kitchen pain points",
          description:
            "Document what frustrates you today: poor workflow, clutter, bad lighting, aging finishes, or limited prep space.",
          impact: "Medium",
          effort: "10 min",
          tags: ["Workflow", "Pain Points"],
          whyItMatters:
            "Pain points are the clearest bridge between inspiration and practical design choices.",
          deliverable: "A before-state list to share with your designer or remodeler.",
          canSkip: true,
        },
      ],
    },
    {
      id: "style",
      title: "Style",
      eyebrow: "Look And Feel",
      summary:
        "Narrow your aesthetic direction and align cabinets, countertops, finishes, and surfaces before selections spiral.",
      goal: "Build a coherent style language you can actually buy and install.",
      activities: [
        {
          id: "style-direction",
          title: "Choose your style direction",
          description:
            "Compare modern organic, transitional, classic, warm minimal, and high-contrast looks.",
          impact: "High",
          effort: "20 min",
          tags: ["Aesthetic", "Mood"],
          whyItMatters:
            "A clear style direction prevents random selections that look good individually but clash together in the final room.",
          deliverable: "A preferred design direction with two backup options.",
          canSkip: false,
        },
        {
          id: "materials-palette",
          title: "Build a materials palette",
          description:
            "Pair cabinet finish, countertop, backsplash, hardware, and flooring into a practical mix.",
          impact: "High",
          effort: "25 min",
          tags: ["Materials", "Finishes"],
          whyItMatters:
            "The material palette affects cost, maintenance, durability, and the overall emotional tone of the space.",
          deliverable: "A shortlist of materials to request in estimates or samples.",
          canSkip: false,
        },
        {
          id: "lighting-mood",
          title: "Set the lighting mood",
          description:
            "Decide how bright, layered, and decorative your lighting plan should feel.",
          impact: "Medium",
          effort: "10 min",
          tags: ["Lighting", "Ambience"],
          whyItMatters:
            "Lighting changes how every other finish reads and can dramatically improve how the kitchen works day to day.",
          deliverable: "A target mood for task, ambient, and accent lighting.",
          canSkip: true,
        },
      ],
    },
    {
      id: "design",
      title: "Design",
      eyebrow: "Function",
      summary:
        "Decide how the kitchen should work by refining layout, storage, and specialized features.",
      goal: "Translate goals and style into a kitchen that functions better every day.",
      activities: [
        {
          id: "layout-options",
          title: "Compare layout options",
          description:
            "Review galley, L-shape, U-shape, one-wall, and island-driven layouts based on your footprint.",
          impact: "High",
          effort: "20 min",
          tags: ["Layout", "Workflow"],
          whyItMatters:
            "Layout decisions shape plumbing, electrical, circulation, and overall project cost more than most finish choices.",
          deliverable: "A preferred layout direction to discuss with a pro.",
          canSkip: false,
        },
        {
          id: "storage-solutions",
          title: "Select storage solutions",
          description:
            "Choose drawers, pull-outs, pantry setups, tray dividers, and waste sorting options that match your habits.",
          impact: "High",
          effort: "15 min",
          tags: ["Storage", "Cabinetry"],
          whyItMatters:
            "Well-targeted storage upgrades often create the most visible day-to-day improvement for homeowners.",
          deliverable: "A list of must-have cabinet and storage features.",
          canSkip: false,
        },
        {
          id: "vanity-features",
          title: "Pick standout vanity-style details",
          description:
            "Decide whether the kitchen should include furniture-style legs, glass fronts, appliance garages, or a statement island treatment.",
          impact: "Medium",
          effort: "15 min",
          tags: ["Features", "Details"],
          whyItMatters:
            "Feature decisions help the space feel custom while keeping decorative upgrades intentional instead of impulsive.",
          deliverable: "A shortlist of high-visual-impact features worth pricing.",
          canSkip: true,
        },
      ],
    },
    {
      id: "planning",
      title: "Planning",
      eyebrow: "Execution",
      summary:
        "Pressure-test the project by building a budget, evaluating professionals, and preparing for disruption at home.",
      goal: "Move from ideas to a realistic plan with fewer surprises.",
      activities: [
        {
          id: "budget-framework",
          title: "Create your budget framework",
          description:
            "Break the project into cabinets, labor, surfaces, appliances, contingencies, and living-with-construction costs.",
          impact: "High",
          effort: "20 min",
          tags: ["Budget", "Risk"],
          whyItMatters:
            "Budget structure helps you spot where flexibility exists and where a low estimate can hide future overruns.",
          deliverable: "A working budget with contingency guidance.",
          canSkip: false,
        },
        {
          id: "find-professional",
          title: "Find the right remodeling professional",
          description:
            "Compare contractor, design-build, and kitchen specialist routes based on your scope and confidence level.",
          impact: "High",
          effort: "20 min",
          tags: ["Hiring", "Vetting"],
          whyItMatters:
            "Choosing the right type of professional early can reshape pricing, schedule realism, and the quality of design support.",
          deliverable: "A shortlist of pros and interview questions.",
          canSkip: false,
        },
        {
          id: "timeline-logistics",
          title: "Map your timeline and logistics",
          description:
            "Plan temporary kitchen setup, delivery windows, lead times, and the order of major decisions.",
          impact: "Medium",
          effort: "15 min",
          tags: ["Timeline", "Prep"],
          whyItMatters:
            "Logistics planning reduces avoidable stress once materials are ordered and demolition starts.",
          deliverable: "A practical pre-construction checklist.",
          canSkip: true,
        },
      ],
    },
  ],
};

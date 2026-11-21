import type { CapabilityManifest, CapabilityProbes } from "../contracts/types.js";

export function detectCapabilities(probes: CapabilityProbes): CapabilityManifest {
  return {
    pptxRead: probes.pptxRead,
    pptxWrite: probes.pptxWrite,
    renderSlides: probes.renderSlides,
    imageAnalysis: probes.imageAnalysis,
    parallelAgents: probes.parallelAgents,
  };
}

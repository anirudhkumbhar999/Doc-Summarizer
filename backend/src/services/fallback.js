const fallbackMessages = {
  insufficient_context:
    "I couldn't build a grounded response from the current transcript context.",
  no_relevant_context:
    "No transcript context was found for this request. Upload a transcript and try again.",
  missing_transcript:
    "No transcript is selected. Upload a transcript first, then request a summary, notes, or answers.",
  llm_unavailable:
    "The language model is not available. Add a valid GROQ_API_KEY so answers can be generated from retrieved context.",
  llm_or_retrieval_failure:
    "The transcript was found, but response generation failed. Try again in a moment.",
};

export function fallbackResponse(reason = "insufficient_context") {
  return {
    answer:
      fallbackMessages[reason] ||
      "I couldn't build a grounded response from the current transcript context.",
    sources: [],
    confidence: "low",
    fallbackReason: reason,
  };
}

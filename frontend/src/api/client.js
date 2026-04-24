import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:4100",
});

export async function checkHealth() {
  const { data } = await api.get("/health");
  return data;
}

export async function uploadDocument({ file, transcriptText, transcriptName }) {
  const formData = new FormData();
  if (file) {
    formData.append("transcript", file);
  }

  if (transcriptText) {
    formData.append("transcriptText", transcriptText);
    if (transcriptName) {
      formData.append("transcriptName", transcriptName);
    }
  }

  const { data } = await api.post("/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function askQuestion({ mode, query, docId }) {
  const { data } = await api.post("/ask", { mode, query, docId });
  return data;
}

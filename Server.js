import express from "express";
import cors from "cors";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();
app.use(cors());

// Orthanc PACS Proxy
app.use(
  "/orthanc",
  createProxyMiddleware({
    target: "http://localhost:8042",   
    changeOrigin: true,
    pathRewrite: { "^/orthanc": "" },
  })
);
app.get("/api/credentials", (req, res) => {
  res.json({
    username: process.env.USERNAME || "admin",
    password: process.env.PASSWORD || "admin123"
  });
});

app.listen(5000, () => {
  console.log("Proxy server running on http://localhost:5000");
});

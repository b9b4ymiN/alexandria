import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Library } from "./routes/library";
import { Reader } from "./routes/reader";
import "./styles/app.css";

// The admin group is a LAZY route so its chunk never loads for a reader
// browsing the public Library. Node G1.11 fills it in; the boundary is
// established here (TECHSTACK.md §22, AGENT.md §25).
const router = createBrowserRouter([
  { path: "/", element: <Library /> },
  { path: "/docs/:slug", element: <Reader /> },
  {
    path: "/admin/*",
    lazy: async () => {
      const module = await import("./routes/admin/index");
      return { element: <module.AdminRoot /> };
    },
  },
]);

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

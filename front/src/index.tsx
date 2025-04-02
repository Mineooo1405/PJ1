import React from "react";
import ReactDOM from "react-dom/client";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import App from "./App";
import "tailwindcss/tailwind.css";


const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
    <DndProvider backend={HTML5Backend}>
      <App />
    </DndProvider>
);

document.body.classList.add(
  "w-screen",
  "h-screen",
  "bg-gray-100",
  "flex",
  "justify-center",
  "items-center"
);

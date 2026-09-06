import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home.jsx";
import SymbolsList from "./pages/SymbolsList.jsx";
import SymbolPage from "./pages/SymbolPage.jsx";
import CharactersList from "./pages/CharactersList.jsx";
import CharacterPage from "./pages/CharacterPage.jsx";
import BackgroundsList from "./pages/BackgroundsList.jsx";
import BackgroundPage from "./pages/BackgroundPage.jsx";
import ReelsPage from "./pages/ReelsPage.jsx";
import ImportAztecPage from "./pages/ImportAztecPage.jsx";
import ProjectPage from "./pages/ProjectPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/symbols" element={<SymbolsList />} />
      <Route path="/symbol/:id" element={<SymbolPage />} />
      <Route path="/characters" element={<CharactersList />} />
      <Route path="/character/:id" element={<CharacterPage />} />
      <Route path="/backgrounds" element={<BackgroundsList />} />
      <Route path="/background/:id" element={<BackgroundPage />} />
      <Route path="/reels" element={<ReelsPage />} />
      <Route path="/import-aztec" element={<ImportAztecPage />} />
      <Route path="/project" element={<ProjectPage />} />
    </Routes>
  );
}

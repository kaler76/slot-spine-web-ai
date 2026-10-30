import { Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import SlotReels from "./components/ui/SlotReels.jsx";

// pagine caricate a richiesta: l'app parte subito, ogni strumento si scarica quando lo si apre
const Home = lazy(() => import("./pages/Home.jsx"));
const SymbolsList = lazy(() => import("./pages/SymbolsList.jsx"));
const SymbolPage = lazy(() => import("./pages/SymbolPage.jsx"));
const CharactersList = lazy(() => import("./pages/CharactersList.jsx"));
const CharacterPage = lazy(() => import("./pages/CharacterPage.jsx"));
const BackgroundsList = lazy(() => import("./pages/BackgroundsList.jsx"));
const BackgroundPage = lazy(() => import("./pages/BackgroundPage.jsx"));
const ReelsPage = lazy(() => import("./pages/ReelsPage.jsx"));
const ImportAztecPage = lazy(() => import("./pages/ImportAztecPage.jsx"));
const ProjectPage = lazy(() => import("./pages/ProjectPage.jsx"));
const RecognizePage = lazy(() => import("./pages/RecognizePage.jsx"));
const AnimatedCharacterPage = lazy(() => import("./pages/AnimatedCharacterPage.jsx"));
const ShowcasePage = lazy(() => import("./pages/ShowcasePage.jsx"));


export default function App() {
  return (
    <Suspense fallback={<div className="page-loading"><SlotReels state="spin" size={52} label="Apro la pagina" /></div>}>
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
      <Route path="/recognize" element={<RecognizePage />} />
      <Route path="/personaggio-animato" element={<AnimatedCharacterPage />} />
      <Route path="/vetrina" element={<ShowcasePage />} />
    </Routes>
    </Suspense>
  );
}

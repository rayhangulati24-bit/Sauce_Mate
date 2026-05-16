import React from "react";
import { AuthProvider } from "./contexts/AuthContext";
import MainComponent from "./components/MainComponent";

function App() {
  return (
    <AuthProvider>
      <MainComponent />
    </AuthProvider>
  );
}

export default App;

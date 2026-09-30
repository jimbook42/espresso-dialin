import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { PressureLabEntry } from './flairPressureLab/PressureLabEntry.jsx'

const root = createRoot(document.getElementById('root'))
const isFlairPressureLab =
  window.location.hash === '#/flair-pressure-lab' ||
  window.location.hash.startsWith('#/flair-pressure-lab?')

if (isFlairPressureLab) {
  import('./flairPressureLab/FlairPressureLab.jsx').then(({ FlairPressureLab }) => {
    root.render(
      <StrictMode>
        <FlairPressureLab />
      </StrictMode>,
    )
  })
} else {
  import('./App.jsx').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
        <PressureLabEntry />
      </StrictMode>,
    )
  })
}

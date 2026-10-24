import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { isPressureLabEnabled } from './config/pressureLabFlag.js'
import { resolveAppEntry } from './appEntry.js'

const root = createRoot(document.getElementById('root'))
const pressureLabEnabled = isPressureLabEnabled()
const entry = resolveAppEntry({
  hash: window.location.hash,
  pressureLabEnabled,
})

if (entry.clearHash) {
  window.location.hash = ''
}

if (entry.entry === 'flair-pressure-lab') {
  import('./flairPressureLab/FlairPressureLab.jsx').then(({ FlairPressureLab }) => {
    const lab = <FlairPressureLab />
    root.render(
      import.meta.env.VITE_PRESSURE_REPLAY === 'true' ? lab : <StrictMode>{lab}</StrictMode>,
    )
  })
} else {
  import('./App.jsx').then(async ({ default: App }) => {
    const children = [<App key="app" />]
    if (pressureLabEnabled) {
      const { PressureLabEntry } = await import('./flairPressureLab/PressureLabEntry.jsx')
      children.push(<PressureLabEntry key="pressure-lab" />)
    }
    root.render(<StrictMode>{children}</StrictMode>)
  })
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { isPressureLabEnabled } from './config/pressureLabFlag.js'

const root = createRoot(document.getElementById('root'))
const pressureLabEnabled = isPressureLabEnabled()
const isFlairPressureLabRoute =
  window.location.hash === '#/flair-pressure-lab' ||
  window.location.hash.startsWith('#/flair-pressure-lab?')

if (isFlairPressureLabRoute && !pressureLabEnabled) {
  window.location.hash = ''
}

if (isFlairPressureLabRoute && pressureLabEnabled) {
  import('./flairPressureLab/FlairPressureLab.jsx').then(({ FlairPressureLab }) => {
    root.render(
      <StrictMode>
        <FlairPressureLab />
      </StrictMode>,
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

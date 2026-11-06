import mermaid from 'mermaid'

const mermaidChart = (code) => {
  // mermaid 12 made `parse()` asynchronous. A Markdown-It fence rule has to return a string
  // synchronously, so the result can no longer gate the output: the old `try { parse } catch`
  // would never fire and a bad diagram became an unhandled rejection. Validate for the sake
  // of surfacing nothing, absorb the rejection, and let the mermaid runtime in the exported
  // page report the error itself — it already renders its own error diagram.
  try {
    Promise.resolve(mermaid.parse(code)).catch(() => { })
  } catch {
    // Older synchronous throw paths (if any) must not escape either.
  }
  return `<div class="mermaid">${code}</div>`
}

const MermaidPlugin = (md) => {
  md.mermaid = mermaid
  mermaid.loadPreferences = (preferenceStore) => {
    let mermaidTheme = preferenceStore.get('mermaid-theme')
    if (mermaidTheme === undefined) {
      mermaidTheme = 'default'
    }
    let ganttAxisFormat = preferenceStore.get('gantt-axis-format')
    if (ganttAxisFormat === undefined) {
      ganttAxisFormat = '%Y-%m-%d'
    }
    mermaid.initialize({
      theme: mermaidTheme,
      gantt: { axisFormatter: [
        [ganttAxisFormat, (d) => {
          return d.getDay() === 1
        }]
      ]}
    })
    return {
      'mermaid-theme': mermaidTheme,
      'gantt-axis-format': ganttAxisFormat
    }
  }

  const temp = md.renderer.rules.fence.bind(md.renderer.rules)
  md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
    const token = tokens[idx]
    const code = token.content.trim()
    if (token.info === 'mermaid') {
      return mermaidChart(code)
    }
    const firstLine = code.split(/\n/)[0].trim()
    if (firstLine === 'gantt' || firstLine === 'sequenceDiagram' || firstLine.match(/^graph (?:TB|BT|RL|LR|TD);?$/)) {
      return mermaidChart(code)
    }
    return temp(tokens, idx, options, env, slf)
  }
}

export default MermaidPlugin

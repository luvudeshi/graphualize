import { useEffect } from 'react'
import { useEditor } from '../state/store'

/**
 * Warns before a reload or a closed tab throws the graph away.
 *
 * Graphualize keeps nothing locally: a graph survives by being saved to an
 * account, and that is the whole rule. The rule is defensible — but only if it
 * is never a surprise. This is the browser's own "Leave site?" prompt, raised
 * exactly when leaving would actually destroy something.
 *
 * Browsers only honour this after the page has been interacted with, and they
 * show their own wording rather than any message supplied here. Neither matters:
 * anyone with an unsaved graph has by definition interacted with the page, and
 * the browser's wording is the one people recognise.
 */
export const ConfirmLeave = () => {
  const dirty = useEditor((s) => s.dirty)
  const hasContent = useEditor((s) => s.doc.vertices.length > 0)

  useEffect(() => {
    if (!dirty || !hasContent) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Still set for older browsers, which required a truthy returnValue.
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty, hasContent])

  return null
}

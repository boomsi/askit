/**
 * askc Auto-render Footer
 * Used by askc apps that export usePanels hook
 *
 * Usage: keel build src/app.tsx -o bundle.js --footer node_modules/askit/src/cli/askc-footer.js
 */
/* Auto-render (askc mode) */
(function () {
  if (typeof __keel_sendBatch === 'function' && globalThis.__keel && globalThis.__keel.guest) {
    try {
      var React = globalThis.React;
      if (!React) {
        console.error('[askc] React not found, cannot auto-render');
        return;
      }

      var KeelReconciler = globalThis.KeelReconciler;
      if (!KeelReconciler || !KeelReconciler.render) {
        console.error('[askc] KeelReconciler not found, cannot auto-render');
        return;
      }

      var GuestExport = globalThis.__keel.guest;
      var element;

      // Check for usePanels hook export (askc panel mode)
      if (typeof GuestExport.usePanels === 'function') {
        console.log('[askc] Detected usePanels hook export');
        var usePanelsHook = GuestExport.usePanels;
        // Create wrapper component that calls usePanels and renders panels with __panelId markers
        function PanelsWrapper() {
          var panels = usePanelsHook();
          return React.createElement(
            'View',
            { style: { flex: 1 } },
            React.createElement('View', { __panelId: 'left', style: { flex: 1 } }, panels.left),
            React.createElement('View', { __panelId: 'right', style: { flex: 1 } }, panels.right)
          );
        }
        element = React.createElement(PanelsWrapper);
      } else {
        // Fallback: default component export
        var Component =
          typeof GuestExport === 'function' ? GuestExport : GuestExport.default || GuestExport;

        if (!Component || typeof Component !== 'function') {
          console.warn('[askc] No valid component or usePanels hook found in guest');
          return;
        }
        element = React.createElement(Component);
      }

      console.log('[askc] Auto-rendering guest');
      KeelReconciler.render(element, __keel_sendBatch);
    } catch (error) {
      console.error('[askc] Auto-render failed:', error);
    }
  }
})();

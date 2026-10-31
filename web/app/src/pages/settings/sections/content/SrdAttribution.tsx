/**
 * The CC-BY-4.0 attribution the SRD licence requires, worded like DPRcalc's SrdLegalFooter. It
 * sits under the list of SRD names so the credit is visible wherever those names are shown.
 */
export function SrdAttribution() {
  return (
    <footer data-testid="srd-attribution" className="mt-2 border-t border-line pt-4 text-12 text-ink-subtle">
      <p>
        This work includes material from the <i>System Reference Document 5.1</i> and{" "}
        <i>System Reference Document 5.2</i> (&ldquo;SRD 5.1&rdquo;, &ldquo;SRD 5.2&rdquo;) by Wizards of the
        Coast LLC, available at{" "}
        <a href="https://www.dndbeyond.com/srd" className="underline">
          dndbeyond.com/srd
        </a>
        . The SRD is licensed under the{" "}
        <a href="https://creativecommons.org/licenses/by/4.0/legalcode" className="underline">
          Creative Commons Attribution 4.0 International License
        </a>
        .
      </p>
      <p className="mt-2">
        Troubadour is unofficial and not affiliated with or endorsed by Wizards of the Coast. Portions of the
        materials used are property of Wizards of the Coast LLC.
      </p>
    </footer>
  )
}

/**
 * Open a provider's sign-in page in a new tab. The tab must open during the click: after an `await`,
 * pop-up blockers refuse it. So open `about:blank` now, drop its opener (the sign-in page must not reach
 * back into this tab), and point it at the URL once it arrives. Closes the tab if getting the URL fails.
 */
export async function openSignIn(getUrl: () => Promise<string>): Promise<void> {
  const tab = window.open("about:blank", "_blank")
  if (tab) tab.opener = null
  try {
    const url = await getUrl()
    if (tab) tab.location.href = url
    else window.location.href = url
  } catch (e) {
    tab?.close()
    throw e
  }
}

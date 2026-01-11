export default {
  async fetch(request: Request) {
    const url = new URL(request.url)

    if (url.pathname === "/triage") {
      return new Response("Triage endpoint OK")
    }

    return new Response("Hello Inbox Triage 👋")
  }
}

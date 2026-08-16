export default {
  async fetch(request) {
    return Response.json({
      ok: true,
      name: "pg-templecleave",
      path: new URL(request.url).pathname,
    });
  },
};

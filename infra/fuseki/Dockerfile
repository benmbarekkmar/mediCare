FROM stain/jena-fuseki:latest

COPY --chmod=755 infra/fuseki/render-entrypoint.sh /render-entrypoint.sh

ENTRYPOINT ["/render-entrypoint.sh"]
CMD ["/jena-fuseki/fuseki-server"]
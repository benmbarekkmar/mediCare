FROM stain/jena-fuseki:latest

COPY infra/fuseki/render-entrypoint.sh /render-entrypoint.sh
RUN chmod 755 /render-entrypoint.sh

ENTRYPOINT ["/render-entrypoint.sh"]
CMD ["/jena-fuseki/fuseki-server"]
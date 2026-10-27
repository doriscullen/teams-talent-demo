FROM eclipse-temurin:21.0.8_9-jdk
WORKDIR /app
RUN useradd --system --uid 1001 carddemo \
    && mkdir -p /var/lib/carddemo/notifications \
    && chown -R carddemo:carddemo /app /var/lib/carddemo
COPY target/installment-service-*.jar app.jar
USER carddemo
EXPOSE 8088
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]

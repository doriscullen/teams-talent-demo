FROM eclipse-temurin:21.0.8_9-jdk
WORKDIR /app
RUN useradd --system --uid 1001 carddemo && chown -R carddemo:carddemo /app
COPY target/installment-service-*.jar app.jar
USER carddemo
EXPOSE 8088
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]

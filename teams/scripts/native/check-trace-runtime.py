"""Read-only capability check in the selected iCode Python. Never configures exporters or calls a model."""
import importlib.metadata
import json

result = {"ready": False}
try:
    result["sdkVersion"] = importlib.metadata.version("opentelemetry-sdk")
    result["exporterVersion"] = importlib.metadata.version("opentelemetry-exporter-otlp-proto-http")
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
    if result["sdkVersion"] != result["exporterVersion"]:
        raise RuntimeError("OTLP HTTP exporter version must match the installed OpenTelemetry SDK")
    result["ready"] = True
except (ImportError, importlib.metadata.PackageNotFoundError, RuntimeError) as error:
    result["reason"] = str(error)
print(json.dumps(result))

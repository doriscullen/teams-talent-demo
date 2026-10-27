"""Read one installed package with iCode's own loader/provider; never run a Skill script."""
import asyncio
import hashlib
from chrys import __version__
import json
import sys
import os
from pathlib import Path

from chrys.foundation.platform import get_platform
from chrys.foundation.config.settings_store import load_settings
from chrys.foundation.models.session_env import SessionEnvironment
from chrys.service.profiles.agents.registry import AgentProfileRegistry
from chrys.service.profiles.agents.loader import scan_profile_dir
from chrys.service.skills.adapter import create_skills_provider

async def main():
    root = Path(sys.argv[1]).resolve(strict=True)
    name = sys.argv[2]
    settings = load_settings(project_root=Path.cwd()).settings
    registry = AgentProfileRegistry()
    registry.load_builtins()
    scan = scan_profile_dir(get_platform().config_dir / 'agents')
    if scan.invalid:
        raise RuntimeError('Native user profile parsing failed; no builtin substitution')
    names = set()
    for path, profile in scan.loaded:
        if path.name != profile.name + '.yaml' or profile.name.casefold() in names or not profile.id:
            raise RuntimeError('Native profile requires migration; this read-only verifier will not rewrite it')
        names.add(profile.name.casefold())
        registry.register(profile)
    profile = registry.resolve_selector(settings.default_agent)
    if profile is None:
        raise RuntimeError('Configured default native profile is unavailable')
    runtime = SessionEnvironment.capture(session_id='teams-skill-read-verification')
    provider, warnings = await create_skills_provider(profile.skills, runtime, project_skills_enabled=settings.project_skills_enabled)
    if provider is None:
        raise RuntimeError('Native skills provider did not initialize')
    matching = [skill for skill in provider._skills if skill.name == name]
    if len(matching) != 1 or Path(matching[0].path).resolve(strict=True) != root:
        sources = [str(candidate.path) for candidate in matching]
        raise RuntimeError('Native default profile resolves another or no source for this name: ' + str(sources))
    skill = matching[0]
    loaded = await provider._load_skill(matching, name)
    if not isinstance(loaded, str) or skill.content.rstrip() not in loaded or str(root) not in loaded:
        raise RuntimeError('Native load_skill did not return the installed instructions')
    resources = []
    for resource in skill.resources:
        text = await provider._read_skill_resource(matching, name, resource.name, max_tokens=10000000)
        expected = await resource.read()
        if not isinstance(text, str) or text != expected:
            raise RuntimeError('Native read_skill_resource mismatch: ' + resource.name)
        resources.append({'name': resource.name, 'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest()})
    result = {
        'nativeVersion': __version__,
        'source': str(root), 'name': name,
        'primarySha256': hashlib.sha256((root / 'SKILL.md').read_bytes()).hexdigest(),
        'loadedInstructionsSha256': hashlib.sha256(loaded.encode('utf-8')).hexdigest(),
        'provider': 'chrys.service.skills.provider.ChrysSkillsProvider',
        'methods': ['create_skills_provider', 'load_skill', 'read_skill_resource'],
        'agent': profile.name, 'agentId': profile.id, 'cwd': os.getcwd(),
        'projectSkillsEnabled': settings.project_skills_enabled, 'globalConfigurationChanged': False,
        'resourcesRead': resources, 'scriptsDiscovered': [script.name for script in skill.scripts],
        'scriptsExecuted': 0, 'modelCalls': 0,
    }
    print(json.dumps(result, ensure_ascii=False))

if len(sys.argv) == 2 and sys.argv[1] == '--environment':
    from chrys.foundation.config.settings import resolve_sessions_dir
    config_dir = get_platform().config_dir.resolve()
    try:
        session_root = str(resolve_sessions_dir(config_dir, create=False).resolve())
    except Exception:
        session_root = str(Path(config_dir) / 'sessions')
    print(json.dumps({'nativeVersion': __version__, 'configDirectory': str(config_dir), 'sessionRoot': session_root, 'python': sys.executable, 'prefix': sys.prefix}))
else:
    asyncio.run(main())

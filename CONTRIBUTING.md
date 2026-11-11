# Contributing to vscode-office

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful and constructive in all interactions. We're here to build great software together.

## Getting Started

### Prerequisites

- Node.js 24+ (use `.nvmrc` with `nvm use`)
- pnpm 12.16.1+
- VS Code 1.125.0+

### Setup

```bash
# Clone the repository
git clone https://github.com/GaussAA/vscode-office.git
cd vscode-office

# Install dependencies
pnpm install

# Run tests
pnpm test

# Build the extension
pnpm build

# Watch mode for development
pnpm watch
```

### Development Workflow

1. **Create a branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow the existing code style
   - Add tests for new features
   - Update documentation as needed

3. **Test your changes**

   ```bash
   pnpm test          # Unit tests
   pnpm typecheck     # Type checking
   pnpm lint          # Linting
   pnpm verify:ui     # UI verification (screenshots)
   pnpm verify:perf   # Performance tests
   ```

4. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat: add your feature"
   ```

   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `style:` - Code style changes (formatting, etc.)
   - `refactor:` - Code refactoring
   - `test:` - Test changes
   - `chore:` - Build process or auxiliary tool changes

5. **Push and create a pull request**
   ```bash
   git push origin feature/your-feature-name
   ```

## Project Structure

```
vscode-office/
├── src/                      # Source code
│   ├── common/              # Shared utilities
│   ├── config/              # Configuration constants
│   ├── react/               # React components (frontend)
│   │   ├── view/           # Viewer components
│   │   │   ├── excel/      # Excel/CSV viewer
│   │   │   ├── parquet/    # Parquet viewer
│   │   │   ├── jsonl/      # JSONL viewer
│   │   └── hooks/          # React hooks
│   └── extension.ts         # Extension entry point
├── test/                    # Tests
│   ├── unit/               # Unit tests
│   └── fixtures/           # Test data
├── docs/                    # Documentation
│   └── adr/                # Architecture Decision Records
└── scripts/                 # Build and utility scripts
```

## Coding Guidelines

### TypeScript

- Use TypeScript for all new code
- Enable strict mode
- Avoid `any` - use proper types or `unknown`
- Document public APIs with JSDoc

### React

- Use functional components with hooks
- Clean up effects with return functions
- Use `useCallback` and `useMemo` appropriately
- Follow the existing component structure

### Testing

- Write tests for new features
- Maintain or improve test coverage
- Test edge cases and error handling
- Use descriptive test names

### Performance

- Be mindful of large file handling
- Use virtualization for long lists
- Implement proper cleanup in components
- Check memory usage with large datasets

## Pull Request Process

1. **Before submitting**
   - Ensure all tests pass
   - Run `pnpm typecheck` and `pnpm lint`
   - Update documentation if needed
   - Add test fixtures if applicable

2. **PR Title**
   - Use conventional commit format
   - Be descriptive but concise
   - Example: `feat(excel): add auto-fit columns`

3. **PR Description**
   - Explain what changed and why
   - Link related issues
   - Include screenshots for UI changes
   - List breaking changes (if any)

4. **Review Process**
   - Address reviewer comments
   - Keep the PR focused and reasonably sized
   - Squash commits if requested

## Adding New Features

### New File Format Support

1. Create viewer component in `src/react/view/<format>/`
2. Add provider in `src/common/providers.ts`
3. Register in `package.json` contributions
4. Add test fixtures in `test/fixtures/`
5. Update `README.md` with supported format
6. Create ADR if architectural decision needed

### New Viewer Features

1. Implement in relevant viewer component
2. Update toolbar/context menu as appropriate
3. Add keyboard shortcuts if applicable
4. Test with various file sizes
5. Document in README or ADR

## Documentation

- Keep README.md up to date
- Document architectural decisions in `docs/adr/`
- Add JSDoc comments for public APIs
- Update CHANGELOG.md (if it exists)
- Include code examples for complex features

## Reporting Bugs

Use GitHub Issues with:

- Clear title describing the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, VS Code version, extension version)
- Sample file (if applicable)
- Screenshots or error messages

## Questions?

- Check existing issues and discussions
- Read the README and documentation
- Ask in GitHub Discussions
- Review Architecture Decision Records in `docs/adr/`

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.

---

Thank you for contributing! 🎉

---
title: Programming Notes
tags:
  - programming
  - learning
created: 2024-01-15
modified: 2024-12-03
aliases:
  - coding notes
  - dev notes
---

# Programming Notes

This is my main hub for programming knowledge. See also [[JavaScript]] and [[TypeScript]].

## Topics

- [[React]] - Frontend framework
- [[Node.js]] - Backend runtime
- [[Algorithms]] - Computer science fundamentals

## Current Learning

#learning #active

- [ ] Complete TypeScript course
- [ ] Read "Clean Code" book
- [x] Set up development environment
- [ ] Practice [[Algorithms|algorithm problems]]

## Quick References

### Code Snippets ^snippets

```javascript
// Debounce function
const debounce = (fn, delay) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
};
```

### Useful Commands ^commands

- `npm init -y` - Initialize project
- `git status` - Check repo status

## Related

- [[Books/Clean Code]]
- [[Projects/Alice AI]]
- #reference #cheatsheet

## Daily Log

### 2024-12-01
Learned about dependency injection today. See [[Design Patterns#DI]].

### 2024-12-02
Worked on [[Projects/Alice AI]] - implemented new feature.


# js-object-functional
Object-Functional programming paradigm for JavaScript, including change isolation, observables, and frozen views.


### Class-based Example

```javascript
const {ObjectFunctional} = require('object-functional')

class CounterWithList extends ObjectFunctional ::
  asAction = this.init
  init(counter=0) ::
    this.counter = counter
    this.lst = Object.freeze @ @[] counter
    return this

  asAction = this.increment
  increment(howHigh=1) ::
    this.counter += howHigh
    this.lst = Object.freeze @ this.lst.concat @ this.counter
    return this

  asAction = this.decrement
  decrement(howLow=1) ::
    this.counter -= howLow
    this.lst = Object.freeze @ this.lst.concat @ this.counter
    return this

  last() ::
    return this.lst[this.lst.length - 1]


// ...

const obj = new CounterWithList().init()
obj.subscribe @ view =>
  console.log('Update:', {view})

setInterval @
  () => obj.increment()
  1000
```



### Prototype-based Example


```javascript
const createCounterWithList = module.asFunctionalProto @:
  counter: 0
  lst: Object.freeze @ []

  asAction: @{}
    increment(howHigh=1) ::
      this.counter += howHigh
      this.lst = Object.freeze @ this.lst.concat @ this.counter
      return this

    decrement(howLow=1) ::
      this.counter -= howLow
      this.lst = Object.freeze @ this.lst.concat @ this.counter
      return this

  last() ::
    return this.lst[this.lst.length - 1]



// ...

const obj = createCounterWithList()
obj.subscribe @ view =>
  console.log('Update:', {view})

setInterval @
  () => obj.increment()
  1000
```


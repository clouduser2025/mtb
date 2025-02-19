import React, { useState, useEffect, useRef } from 'react';
import { Container, Button, Table, Form, Alert, Modal, Row, Col, Dropdown, ButtonGroup } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faUserCog, 
  faUserPlus, 
  faUsers, 
  faSignInAlt, 
  faShoppingCart, 
  faUser, 
  faChartLine,
  faDollarSign,
  faChartBar,
  faBullseye,
} from '@fortawesome/free-solid-svg-icons';
import './css/landing.css';

const Landing = () => {
  /********************************************************
   *           STATES & REGISTRATION SETUP              *
   ********************************************************/
  const [users, setUsers] = useState([]); 
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [openTrades, setOpenTrades] = useState([]);  
  const [showTradesDashboard, setShowTradesDashboard] = useState(false);

  const [formStep, setFormStep] = useState(1); // 1: Select Users, 2: Trade Conditions, 3: Confirm Buy
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    broker: "Angel",
    api_key: "",
    totp_token: "",
    tradingsymbol: "",
    symboltoken: "3045",
    exchange: "NSE",
    strike_price: 0,
    producttype: "INTRADAY",
    buy_threshold_offset: 0,
    buy_percentage: 0,
    sell_threshold_offset: 0,
    sell_percentage: 0,
    stop_loss_type: "Fixed",
    stop_loss_value: 0,
    points_condition: 0,
  });

  const [ltpPrice, setLtpPrice] = useState(null);
  const [loadingLtp, setLoadingLtp] = useState(false);

  /********************************************************
   *                 API FUNCTIONS                      *
   ********************************************************/

  const fetchUsers = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_users", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const data = await response.json();
      setUsers(data.users);
    } catch (error) {
      console.error("Error fetching users:", error);
      setMessage({ text: "Failed to fetch users", type: "danger" });
    }
  };

  const fetchOpenPositions = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_open_positions", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const data = await response.json();
      setOpenTrades(data.positions);
    } catch (error) {
      console.error("Error fetching open positions:", error);
      setMessage({ text: "Failed to fetch open positions", type: "danger" });
    }
  };

  const fetchLtp = async () => {
    if (!formData.tradingsymbol || !formData.symboltoken) {
      setMessage({ text: "Please enter a trading symbol and symbol token.", type: "warning" });
      return;
    }
    setLoadingLtp(true);
    try {
      const response = await fetch(`https://mtb-8ra9.onrender.com/api/fetch_ltp?exchange=${formData.exchange}&symbol=${formData.tradingsymbol}&token=${formData.symboltoken}`);
      const data = await response.json();
      if (data.status) {
        setLtpPrice(data.ltp);
        setMessage({ text: `LTP fetched successfully: ₹${data.ltp}`, type: "success" });
      } else {
        setLtpPrice(null);
        setMessage({ text: "Failed to fetch LTP. Check symbol and token.", type: "danger" });
      }
    } catch (error) {
      console.error("Error fetching LTP:", error);
      setMessage({ text: "Server error fetching LTP. Try again later.", type: "danger" });
    } finally {
      setLoadingLtp(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/register_user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: formData.username,
          password: formData.password,
          broker: formData.broker,
          api_key: formData.api_key,
          totp_token: formData.totp_token,
          default_quantity: parseInt(formData.default_quantity || 1, 10),
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setMessage({ text: "User registered successfully!", type: "success" });
        fetchUsers();
        setFormData({
          username: "",
          password: "",
          broker: "Angel",
          api_key: "",
          totp_token: "",
          tradingsymbol: "",
          symboltoken: "3045",
          exchange: "NSE",
          strike_price: 0,
          producttype: "INTRADAY",
          buy_threshold_offset: 0,
          buy_percentage: 0,
          sell_threshold_offset: 0,
          sell_percentage: 0,
          stop_loss_type: "Fixed",
          stop_loss_value: 0,
          points_condition: 0,
        });
        setShowRegisterModal(false);
      } else {
        setMessage({ text: data.detail || "Registration failed", type: "danger" });
      }
    } catch (error) {
      console.error("Error registering user:", error);
      setMessage({ text: "Server error. Try again later.", type: "danger" });
    }
  };

  const handleDeleteUser = async (username) => {
    try {
      const response = await fetch(`https://mtb-8ra9.onrender.com/api/delete_user/${username}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (response.ok) {
        setUsers(users.filter(user => user.username !== username));
        setMessage({ text: "User deleted successfully!", type: "success" });
      } else {
        setMessage({ text: data.detail || "Failed to delete user", type: "danger" });
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      setMessage({ text: "Server error. Try again later.", type: "danger" });
    }
  };

  const handleInitiateBuy = async () => {
    if (!selectedUsers.length) {
      setMessage({ text: "Please select at least one user.", type: "warning" });
      return;
    }

    try {
      for (const username of selectedUsers) {
        const response = await fetch("https://mtb-8ra9.onrender.com/api/initiate_buy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            tradingsymbol: formData.tradingsymbol,
            symboltoken: formData.symboltoken,
            exchange: formData.exchange,
            strike_price: formData.strike_price,
            producttype: formData.producttype,
            buy_threshold_offset: formData.buy_threshold_offset || null,
            buy_percentage: formData.buy_percentage || null,
            stop_loss_type: formData.stop_loss_type,
            stop_loss_value: formData.stop_loss_value,
            points_condition: formData.points_condition,
            sell_threshold_offset: formData.sell_threshold_offset || null,
          }),
        });

        const data = await response.json();
        if (response.ok) {
          setMessage({ text: `Buy initiated successfully for ${username}!`, type: "success" });
          fetchOpenPositions();
        } else {
          setMessage({ text: `Failed to initiate buy for ${username}: ${data.detail}`, type: "danger" });
        }
      }
    } catch (error) {
      console.error("Error initiating buy:", error);
      setMessage({ text: "Server error initiating buy. Try again later.", type: "danger" });
    }
    setFormStep(1);
    setSelectedUsers([]);
    setFormData({
      username: "",
      password: "",
      broker: "Angel",
      api_key: "",
      totp_token: "",
      tradingsymbol: "",
      symboltoken: "3045",
      exchange: "NSE",
      strike_price: 0,
      producttype: "INTRADAY",
      buy_threshold_offset: 0,
      buy_percentage: 0,
      sell_threshold_offset: 0,
      sell_percentage: 0,
      stop_loss_type: "Fixed",
      stop_loss_value: 0,
      points_condition: 0,
    });
  };

  const UserActionsDropdown = ({ setShowRegisterModal, setShowUsers, showUsers }) => (
    <Dropdown as={ButtonGroup}>
      <Dropdown.Toggle variant="primary" id="dropdown-basic" className="user-actions-dropdown">
        <FontAwesomeIcon icon={faUserCog} />
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item onClick={() => setShowRegisterModal(true)}>
          <FontAwesomeIcon icon={faUserPlus} className="me-2" /> Register
        </Dropdown.Item>
        <Dropdown.Item onClick={() => { setShowUsers(!showUsers); fetchUsers(); }}>
          <FontAwesomeIcon icon={faUsers} className="me-2" /> View Users
        </Dropdown.Item>
        <Dropdown.Item onClick={() => window.open('https://www.angelone.in/login/?redirectUrl=account', '_blank')}>
          <FontAwesomeIcon icon={faSignInAlt} className="me-2" /> Angel Login
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );

  const AdvancedChart = ({ symbol, openTrades }) => {
    const chartContainerRef = useRef(null);
    const tvWidgetRef = useRef(null);

    useEffect(() => {
      const loadTradingViewScript = () => {
        if (window.TradingView) {
          initChart();
          return;
        }
        const script = document.createElement("script");
        script.src = "https://s3.tradingview.com/tv.js";
        script.async = true;
        script.onload = initChart;
        document.body.appendChild(script);
      };

      const initChart = () => {
        if (!window.TradingView) return;
        tvWidgetRef.current = new window.TradingView.widget({
          autosize: true,
          symbol: symbol || "NSE:SBIN",
          interval: "1",
          container_id: "advanced_chart_container",
          datafeed: window.TradingView.defaultDatafeed,
          library_path: "/charting_library/",
          locale: "en",
          disabled_features: ["header_saveload"],
          enabled_features: [],
          onChartReady: () => console.log("Advanced chart is ready"),
        });
      };

      loadTradingViewScript();

      return () => {
        if (tvWidgetRef.current) tvWidgetRef.current.remove();
      };
    }, [symbol]);

    useEffect(() => {
      if (tvWidgetRef.current) {
        updateMarkers(openTrades);
      }
    }, [openTrades, symbol]);

    const updateMarkers = (trades) => {
      if (!tvWidgetRef.current || !tvWidgetRef.current.chart) return;
      tvWidgetRef.current.chart().removeAllShapes();
      trades.forEach((trade) => {
        const time = Math.floor(Date.now() / 1000);
        tvWidgetRef.current.chart().createShape(
          { time, price: trade.entry_price },
          {
            shape: "arrow_up",
            text: `Buy by ${trade.username} at ${trade.entry_price}`,
            color: "green",
            disableUndo: true
          }
        );
      });
    };

    return <div id="advanced_chart_container" ref={chartContainerRef} style={{ height: "500px", width: "100%" }}></div>;
  };

  /********************************************************
   *                     RENDER (JSX)                     *
   ********************************************************/
  useEffect(() => {
    fetchUsers();
    fetchOpenPositions();
  }, []);

  return (
    <Container className="mt-4">
      <Row className="justify-content-end mb-3" style={{ position: "absolute", top: "9%", right: "10px", zIndex: "1000" }}>
        <Col xs="auto">
          <UserActionsDropdown setShowRegisterModal={setShowRegisterModal} setShowUsers={setShowUsers} showUsers={showUsers} />
        </Col>
      </Row>

      {showUsers && (
        <Container className="users-table-container mb-5">
          <h3 className="text-center mb-4 text-primary">
            <FontAwesomeIcon icon={faUsers} className="me-2" /> Registered Users
          </h3>
          <Table striped bordered hover className="users-table shadow-sm">
            <thead>
              <tr>
                <th className="table-header bg-primary text-white">#</th>
                <th className="table-header bg-success text-white">Username</th>
                <th className="table-header bg-info text-white">Broker</th>
                <th className="table-header bg-warning text-dark">Default Quantity</th>
                <th className="table-header bg-danger text-white">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length > 0 ? (
                users.map((user, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>{user.username}</td>
                    <td>{user.broker}</td>
                    <td>{user.default_quantity}</td>
                    <td>
                      <Button variant="danger" size="sm" onClick={() => handleDeleteUser(user.username)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" className="text-muted text-center">No registered users found.</td>
                </tr>
              )}
            </tbody>
          </Table>
        </Container>
      )}

      {showTradesDashboard && (
        <>
          <Container className="mt-5 p-4 traders-table-container shadow-lg rounded bg-white">
            <h3 className="text-center mb-4 text-dark fw-bold">
              <FontAwesomeIcon icon={faShoppingCart} className="me-2 text-primary" /> Active Trades
            </h3>
            <Table striped bordered hover className="traders-table shadow-sm">
              <thead className="text-center">
                <tr>
                  <th>#</th>
                  <th className="bg-primary text-white"><FontAwesomeIcon icon={faUser} /> Username</th>
                  <th className="bg-info text-white"><FontAwesomeIcon icon={faChartLine} /> Symbol</th>
                  <th className="bg-dark text-white"><FontAwesomeIcon icon={faDollarSign} /> Entry Price</th>
                  <th className="bg-danger text-white"><FontAwesomeIcon icon={faChartBar} /> Buy Threshold</th>
                  <th className="bg-secondary text-white"><FontAwesomeIcon icon={faBullseye} /> Stop-Loss/Sell</th>
                </tr>
              </thead>
              <tbody>
                {openTrades.length > 0 ? (
                  openTrades.map((trade, index) => (
                    <tr key={index} className="align-middle text-center">
                      <td><strong className="text-secondary">{index + 1}</strong></td>
                      <td className="fw-bold text-warning">{trade.username}</td>
                      <td className="text-primary fw-bold">{trade.symbol}</td>
                      <td className="text-success fw-bold">₹{trade.entry_price}</td>
                      <td className="text-danger fw-bold">{trade.buy_threshold}</td>
                      <td className="text-info">{trade.stop_loss_type} at {trade.stop_loss_value} (Points: {trade.points_condition})</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="6" className="text-muted text-center">No active trades found.</td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Container>
          <Container className="mt-5 p-4 bg-light rounded shadow-lg">
            <h4 className="text-center mb-3 text-dark fw-bold">📊 Live Chart with Open Trades</h4>
            <AdvancedChart symbol={formData.tradingsymbol} openTrades={openTrades} />
          </Container>
        </>
      )}

      <Row className="justify-content-center mb-3">
        <Col xs="auto">
          <Button onClick={() => window.open('https://www.angelone.in/trade/markets/equity/overview', '_blank')} className="gradient-button btn-market">
            Market Overview
          </Button>
        </Col>
        <Col xs="auto">
          <Button onClick={() => window.open('https://www.angelone.in/trade/indices/indian', '_blank')} className="gradient-button btn-indices">
            Indices
          </Button>
        </Col>
        <Col xs="auto">
          <Button onClick={() => window.open('https://www.angelone.in/trade/watchlist/chart', '_blank')} className="gradient-button btn-chart">
            Chart
          </Button>
        </Col>
        <Col xs="auto">
          <Button onClick={() => window.open('https://www.angelone.in/trade/watchlist/option-chain', '_blank')} className="gradient-button btn-option">
            Option Chain
          </Button>
        </Col>
        <Col xs="auto">
          <Button onClick={() => { setShowTradesDashboard(!showTradesDashboard); fetchOpenPositions(); }} className="gradient-button btn-trades">
            Trades Dashboard
          </Button>
        </Col>
        <Col xs="auto">
          <Button onClick={fetchLtp} className="gradient-button btn-ltp" disabled={loadingLtp}>
            {loadingLtp ? "Fetching..." : "Fetch LTP"}
          </Button>
        </Col>
      </Row>

      <Container className="mt-4 p-3 border rounded shadow-sm">
        {formStep === 1 && (
          <>
            <h4 className="text-success">
              <FontAwesomeIcon icon={faUser} /> Select Users (1 to 3)
            </h4>
            <Form>
              <Row className="mb-3">
                <Col>
                  {users.map((user, index) => (
                    <Form.Check
                      key={index}
                      type="checkbox"
                      label={user.username}
                      checked={selectedUsers.includes(user.username)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          if (selectedUsers.length < 3) {
                            setSelectedUsers([...selectedUsers, user.username]);
                          } else {
                            alert("⚠ You can only select up to 3 users.");
                          }
                        } else {
                          setSelectedUsers(selectedUsers.filter(u => u !== user.username));
                        }
                      }}
                    />
                  ))}
                </Col>
              </Row>
              <Button 
                variant="primary" 
                onClick={() => setFormStep(2)}
                disabled={!selectedUsers.length}
                className="mt-3"
              >
                Next
              </Button>
            </Form>
          </>
        )}

        {formStep === 2 && (
          <>
            <h4 className="text-success">
              <FontAwesomeIcon icon={faBullseye} /> Set Trade Conditions
            </h4>
            <Form>
              <Row className="mb-3">
                <Col md={4}>
                  <Form.Group controlId="tradingsymbol">
                    <Form.Label>Trading Symbol</Form.Label>
                    <Form.Control 
                      type="text" 
                      placeholder="e.g., SBIN-EQ" 
                      value={formData.tradingsymbol} 
                      onChange={(e) => setFormData({ ...formData, tradingsymbol: e.target.value })}
                      required 
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="symboltoken">
                    <Form.Label>Symbol Token</Form.Label>
                    <Form.Control 
                      type="text" 
                      placeholder="e.g., 3045" 
                      value={formData.symboltoken} 
                      onChange={(e) => setFormData({ ...formData, symboltoken: e.target.value })}
                      required 
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="strike_price">
                    <Form.Label>Strike Price</Form.Label>
                    <Form.Control 
                      type="number" 
                      placeholder="e.g., 100" 
                      value={formData.strike_price} 
                      onChange={(e) => setFormData({ ...formData, strike_price: parseFloat(e.target.value) || 0 })}
                      required 
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Row className="mb-3">
                <Col md={4}>
                  <Form.Group controlId="buy_threshold_offset">
                    <Form.Label>Buy Threshold Offset</Form.Label>
                    <Form.Control 
                      type="number" 
                      placeholder="e.g., 10 for +10" 
                      value={formData.buy_threshold_offset} 
                      onChange={(e) => setFormData({ ...formData, buy_threshold_offset: parseFloat(e.target.value) || 0 })}
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="buy_percentage">
                    <Form.Label>Buy Percentage Increase (%)</Form.Label>
                    <Form.Control 
                      type="number" 
                      placeholder="e.g., 5 for 5%" 
                      value={formData.buy_percentage} 
                      onChange={(e) => setFormData({ ...formData, buy_percentage: parseFloat(e.target.value) || 0 })}
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="sell_threshold_offset">
                    <Form.Label>Sell Threshold Offset</Form.Label>
                    <Form.Control 
                      type="number" 
                      placeholder="e.g., -5 for -5" 
                      value={formData.sell_threshold_offset} 
                      onChange={(e) => setFormData({ ...formData, sell_threshold_offset: parseFloat(e.target.value) || 0 })}
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Row className="mb-3">
                <Col md={4}>
                  <Form.Group controlId="stop_loss_type">
                    <Form.Label>Stop-Loss Type</Form.Label>
                    <Form.Select 
                      value={formData.stop_loss_type} 
                      onChange={(e) => setFormData({ ...formData, stop_loss_type: e.target.value })}
                    >
                      <option value="Fixed">Fixed</option>
                      <option value="Percentage">Percentage</option>
                      <option value="Points">Points</option>
                      <option value="Combined">Combined</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="stop_loss_value">
                    <Form.Label>Stop-Loss Value</Form.Label>
                    <Form.Control 
                      type="number" 
                      placeholder="e.g., 5 or 50%" 
                      value={formData.stop_loss_value} 
                      onChange={(e) => setFormData({ ...formData, stop_loss_value: parseFloat(e.target.value) || 0 })}
                      required 
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="points_condition">
                    <Form.Label>Points Condition</Form.Label>
                    <Form.Control 
                      type="number" 
                      placeholder="e.g., 0 or -0.2" 
                      value={formData.points_condition} 
                      onChange={(e) => setFormData({ ...formData, points_condition: parseFloat(e.target.value) || 0 })}
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Button 
                variant="primary" 
                onClick={() => setFormStep(3)}
                className="mt-3"
              >
                Next
              </Button>
              <Button 
                variant="secondary" 
                onClick={() => setFormStep(1)}
                className="mt-3 ms-2"
              >
                Back
              </Button>
            </Form>
          </>
        )}

        {formStep === 3 && (
          <>
            <h4 className="text-success">
              <FontAwesomeIcon icon={faShoppingCart} /> Confirm Buy
            </h4>
            <Form>
              <Row className="mb-3">
                <Col>
                  <p><strong>Selected Users:</strong> {selectedUsers.join(", ") || "None"}</p>
                  <p><strong>Symbol:</strong> {formData.tradingsymbol}</p>
                  <p><strong>Strike Price:</strong> ₹{formData.strike_price}</p>
                  <p><strong>Buy Threshold:</strong> {formData.buy_threshold_offset ? `≥ ${formData.strike_price + formData.buy_threshold_offset}` : formData.buy_percentage ? `≥ ${formData.strike_price * (1 + formData.buy_percentage/100)}` : "None"}</p>
                  <p><strong>Sell Threshold:</strong> {formData.sell_threshold_offset ? `≤ ${formData.strike_price + formData.sell_threshold_offset}` : "None"}</p>
                  <p><strong>Stop-Loss:</strong> {formData.stop_loss_type} at {formData.stop_loss_value} {formData.stop_loss_type === "Percentage" ? "%" : ""} (Points: {formData.points_condition})</p>
                  {ltpPrice && <p><strong>Current LTP:</strong> ₹{ltpPrice}</p>}
                </Col>
              </Row>
              <Button 
                variant="primary" 
                onClick={handleInitiateBuy}
                className="mt-3"
                disabled={loadingLtp || !ltpPrice}
              >
                Initiate Buy
              </Button>
              <Button 
                variant="secondary" 
                onClick={() => setFormStep(2)}
                className="mt-3 ms-2"
              >
                Back
              </Button>
            </Form>
          </>
        )}
      </Container>

      <Modal show={showRegisterModal} onHide={() => setShowRegisterModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Register User</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {message.text && <Alert variant={message.type}>{message.text}</Alert>}
          <Form onSubmit={handleRegisterSubmit}>
            <Form.Group controlId="username">
              <Form.Label>Username</Form.Label>
              <Form.Control type="text" placeholder="Enter username" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required />
            </Form.Group>
            <Form.Group controlId="password">
              <Form.Label>Password</Form.Label>
              <Form.Control type="password" placeholder="Enter password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required />
            </Form.Group>
            <Form.Group controlId="broker">
              <Form.Label>Broker</Form.Label>
              <Form.Select value={formData.broker} onChange={(e) => setFormData({ ...formData, broker: e.target.value })}>
                <option value="Angel">Angel</option>
                <option value="Zerodha">Zerodha</option>
              </Form.Select>
            </Form.Group>
            <Form.Group controlId="api_key">
              <Form.Label>API Key</Form.Label>
              <Form.Control type="text" placeholder="Enter API Key" value={formData.api_key} onChange={(e) => setFormData({ ...formData, api_key: e.target.value })} required />
            </Form.Group>
            <Form.Group controlId="totp_token">
              <Form.Label>TOTP Token</Form.Label>
              <Form.Control type="text" placeholder="Enter TOTP Token" value={formData.totp_token} onChange={(e) => setFormData({ ...formData, totp_token: e.target.value })} required />
            </Form.Group>
            <Form.Group controlId="default_quantity">
              <Form.Label>Default Quantity</Form.Label>
              <Form.Control type="number" placeholder="Enter Quantity" value={formData.default_quantity} onChange={(e) => setFormData({ ...formData, default_quantity: e.target.value })} required />
            </Form.Group>
            <Button variant="primary" type="submit" className="mt-3">Register</Button>
          </Form>
        </Modal.Body>
      </Modal>

      {message.text && <Alert variant={message.type} className="mt-3">{message.text}</Alert>}
    </Container>
  );
};

export default Landing;